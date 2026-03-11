import { Bot, InlineKeyboard, Keyboard, session, InputFile } from "grammy";
import algoliasearch from "algoliasearch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { faqCategories } from "./faqData.js";
import { 
  initDb, 
  migrateFaqData, 
  saveUser,
  getUserInfo,
  toggleFavorite, 
  getFavorites, 
  isFavorite, 
  incrementQuestionStat, 
  getTopQuestions as getTopQuestionsDb,
  addRecentQuestion,
  getRecentQuestions,
  clearRecentQuestions,
  logSearch,
  getUserSearchCount,
} from "./database.js";

if (!config.token) {
  console.error("TELEGRAM_TOKEN отсутствует в окружении/.env");
  process.exit(1);
}

const faqQuestionsMap = new Map();
let algoliaIndex = null;
let algoliaReady = false;

function indexFaq() {
  faqQuestionsMap.clear();
  for (const category of faqCategories) {
    for (const item of category.items) {
      faqQuestionsMap.set(item.id, {
        ...item,
        categoryId: category.id,
        categoryTitle: category.title,
      });
    }
  }
}

indexFaq();

// --- Встроенный fuzzy-поиск (без внешних сервисов) ---
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(str) {
  return normalize(str).split(" ").filter(Boolean);
}

function fuzzyMatch(needle, haystack) {
  if (haystack.includes(needle)) return true;
  // Префиксное совпадение: учитываем опечатки в окончаниях слов
  for (let len = needle.length; len >= 3; len--) {
    if (haystack.includes(needle.slice(0, len))) return true;
  }
  return false;
}

function searchFaqLocal(query, limit = 5) {
  const queryTokens = tokenize(query).filter(t => t.length >= 2);
  if (!queryTokens.length) return [];

  const results = [];
  for (const item of faqQuestionsMap.values()) {
    const questionText = normalize(item.question);
    const answerText = normalize(item.answer);
    const kwText = normalize((item.keywords || []).join(" "));
    const fullText = [questionText, answerText, kwText].join(" ");

    let score = 0;
    let matchedTokens = 0;

    for (const token of queryTokens) {
      if (!fuzzyMatch(token, fullText)) continue;
      matchedTokens++;
      if (fuzzyMatch(token, questionText)) score += 4; // вопрос важнее
      if (fuzzyMatch(token, kwText)) score += 2;       // ключевые слова
      score += 1;                                       // просто в тексте
    }

    if (matchedTokens === 0) continue;
    // Штраф за неполное покрытие запроса
    score *= (matchedTokens / queryTokens.length);
    results.push({ item, score });
  }

  return results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}


async function indexAlgolia() {
  if (!config.algoliaAppId || !config.algoliaApiKey || !config.algoliaIndexName) {
    return;
  }
  try {
    const client = algoliasearch(config.algoliaAppId, config.algoliaApiKey);
    const index = client.initIndex(config.algoliaIndexName);
    const records = [];
    for (const category of faqCategories) {
      for (const item of category.items) {
        records.push({
          objectID: String(item.id),
          faqId: item.id,
          question: item.question,
          answer: item.answer,
          categoryId: category.id,
          categoryTitle: category.title,
          keywords: item.keywords || [],
        });
      }
    }
    await index.saveObjects(records, { autoGenerateObjectIDIfNotExist: false });
    algoliaIndex = index;
    algoliaReady = true;
  } catch (e) {
    console.error("Ошибка индексации Algolia:", e);
  }
}

async function searchAlgoliaFaq(query, limit = 5) {
  if (!algoliaReady || !algoliaIndex) {
    return [];
  }
  try {
    const res = await algoliaIndex.search(query, { hitsPerPage: limit });
    const results = [];
    for (const hit of res.hits) {
      const id = hit.faqId || parseInt(hit.objectID, 10);
      const item = faqQuestionsMap.get(id);
      if (!item) {
        continue;
      }
      results.push({ item, score: 100 });
    }
    return results;
  } catch (e) {
    console.error("Ошибка поиска Algolia:", e);
    return [];
  }
}

function initialSession() {
  return {
    awaitingSearch: false,
    lastSearchQuery: "",
    lastCategoryId: null,
    recentQuestions: [],
    totalQuestionsViewed: 0,
    totalSearches: 0,
  };
}

const bot = new Bot(config.token);
bot.use(session({ initial: initialSession }));

// Middleware для сохранения пользователя в БД при любом взаимодействии
bot.use(async (ctx, next) => {
  if (ctx.from) {
    saveUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  }
  return await next();
});

(async () => {
  try {
    // Инициализация БД
    initDb();
    migrateFaqData(faqCategories);

    await indexAlgolia();
    await bot.api.setMyCommands([
      { command: "start", description: "Главное меню" },
      { command: "help", description: "Справка по использованию бота" },
    ]);
  } catch (e) {
    console.error("Не удалось выполнить инициализацию бота:", e);
  }
})();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imgDirs = [
  path.resolve(__dirname, "../img"),
  path.resolve(__dirname, "../../img"),
  path.resolve(process.cwd(), "img"),
];
let imgIndex = null;

function indexImages() {
  if (imgIndex) return imgIndex;
  imgIndex = [];
  for (const dir of imgDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const ext = path.extname(f).toLowerCase();
      if (!fs.statSync(full).isFile()) continue;
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
      imgIndex.push({ dir, name: f.toLowerCase(), full });
    }
  }
  return imgIndex;
}

function findImageByKeywords(keywords) {
  const files = indexImages();
  for (const kw of keywords) {
    const hit = files.find((x) => x.name.includes(kw));
    if (hit) return hit.full;
  }
  return null;
}

async function sendMenuPhoto(ctx, sectionKey, caption, kb) {
  const sectionKeywords = {
    home: ["main menu", "home", "main", "start", "banner", "главное", "старт", "баннер"],
    categories: ["select question", "categories", "категории", "вопросы", "menu", "list"],
    search: ["search", "find", "поиск", "вопрос"],
    stats: ["stats", "chart", "statistics", "статистика"],
    help: ["help", "faq", "question", "помощь", "вопрос"],
    about: ["about", "info", "о боте", "инфо", "logo"],
    favorites: ["favorites", "избранное", "fav"],
    recent: ["recent", "недавние", "history"],
    profile: ["profile", "профиль", "user"],
    commands: ["commands", "команды", "help", "faq"],
  };
  const p = findImageByKeywords(sectionKeywords[sectionKey] || []);
  const hasCallback = !!ctx.callbackQuery;
  if (hasCallback) {
    await ctx.answerCallbackQuery().catch(() => {});
    if (p) {
      const file = new InputFile(fs.createReadStream(p));
      await ctx
        .editMessageMedia(
          {
            type: "photo",
            media: file,
            caption,
            parse_mode: "HTML",
          },
          { reply_markup: kb },
        )
        .catch(async () => {
          await ctx.replyWithPhoto(file, {
            caption,
            reply_markup: kb,
            parse_mode: "HTML",
          });
        });
    } else {
      await ctx
        .editMessageText(caption, { reply_markup: kb, parse_mode: "HTML" })
        .catch(async () => {
          await ctx.reply(caption, { reply_markup: kb, parse_mode: "HTML" });
        });
    }
  } else {
    if (p) {
      const file = new InputFile(fs.createReadStream(p));
      await ctx.replyWithPhoto(file, { caption, reply_markup: kb, parse_mode: "HTML" });
    } else {
      await ctx.reply(caption, { reply_markup: kb, parse_mode: "HTML" });
    }
  }
}

function startKeyboard() {
  const kb = new InlineKeyboard()
    .text("📚 Вопросы по категориям", "categories").row()
    .text("🔎 Поиск по вопросу", "search").row()
    .text("📊 Популярные вопросы", "stats").row()
    .text("⭐ Избранное", "favorites")
    .text("🕒 Недавние", "recent").row()
    .text("👤 Профиль", "profile").row()
    .text("❓ Помощь", "help")
    .text("ℹ️ О боте", "about");
  return kb;
}

function backHomeKeyboard() {
  return new InlineKeyboard().text("🏠 Главное меню", "start");
}

function categoriesKeyboard() {
  const kb = new InlineKeyboard();
  for (const category of faqCategories) {
    const icon = getCategoryIcon(category.id);
    const label = `${icon} ${category.title}`;
    kb.text(label, `cat_${category.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  return kb;
}

function getCategoryIcon(categoryId) {
  switch (categoryId) {
    case 1:
      return "📝";
    case 2:
      return "📅";
    case 3:
      return "📚";
    case 4:
      return "☎️";
    case 5:
      return "💻";
    case 6:
      return "🎯";
    case 7:
      return "🎗";
    case 8:
      return "🏠";
    default:
      return "❓";
  }
}

function questionsKeyboard(categoryId) {
  const kb = new InlineKeyboard();
  const category = faqCategories.find((c) => c.id === categoryId);
  if (!category) {
    kb.text("🏠 Главное меню", "start");
    return kb;
  }
  const icon = getCategoryIcon(categoryId);
  for (const item of category.items) {
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    const label = `${icon} ${shortTitle}`;
    kb.text(label, `faq_${item.id}`).row();
  }
  kb.text("⬅️ К категориям", "categories").row().text("🏠 Главное меню", "start");
  return kb;
}

function formatFaqAnswer(item) {
  return `❓ <b>Вопрос:</b> ${item.question}\n\n💬 <b>Ответ:</b> ${item.answer}`;
}

function commandsHelpText() {
  return [
    "💡 Подсказки по командам",
    "",
    "/start — запустить бота и показать главное меню.",
    "/help — краткая справка по использованию бота.",
  ].join("\n");
}

bot.command("start", async (ctx) => {
  const text = [
    `👋 Вас приветствует официальный информационный бот ГАПОУ «Сыктывкарский лесопромышленный техникум».`,
    "",
    "Я помогу вам быстро получить ответы на вопросы о поступлении, специальностях и студенческой жизни в СЛТ.",
    "",
    "<b>Основные разделы:</b>",
    "• Правила приема и документы",
    "• Сроки подачи заявлений",
    "• Перечень специальностей 2025",
    "• Общежитие и стипендии",
    "",
    "Выберите нужный раздел в меню или просто напишите свой вопрос в чат.",
  ].join("\n");
  await sendMenuPhoto(ctx, "home", text, startKeyboard());
});

bot.command("help", async (ctx) => {
  const text = [
    "❓ <b>Справка по использованию бота СЛТ</b>",
    "",
    "1) <b>Категории:</b> Нажмите «Вопросы по категориям», чтобы выбрать интересующий вас раздел (например, «Специальности» или «Общежитие»).",
    "2) <b>Поиск:</b> Нажмите «Поиск по вопросу» и введите свой запрос текстом (например, <i>«как подать документы?»</i>).",
    "3) <b>Избранное:</b> Сохраняйте важные ответы, нажимая кнопку ⭐ под сообщением.",
    "",
    "<b>Техническая поддержка:</b>",
    "Если вы не нашли ответ, обратитесь в приёмную комиссию СЛТ по телефону 8(8212) 62-50-53.",
  ].join("\n");
  await sendMenuPhoto(ctx, "help", text, backHomeKeyboard());
});

bot.command("commands", async (ctx) => {
  const text = commandsHelpText();
  await sendMenuPhoto(ctx, "commands", text, backHomeKeyboard());
});

bot.callbackQuery("start", async (ctx) => {
  const text = "🏠 Главное меню. Выберите нужный раздел ниже.";
  await sendMenuPhoto(ctx, "home", text, startKeyboard());
});

bot.callbackQuery("help", async (ctx) => {
  const text = [
    "❓ Помощь",
    "",
    "• «Вопросы по категориям» — навигация по разделам.",
    "• «Поиск по вопросу» — введите свой вопрос текстом.",
    "• «Популярные вопросы» — часто задаваемые вопросы.",
  ].join("\n");
  await sendMenuPhoto(ctx, "help", text, backHomeKeyboard());
});

bot.callbackQuery("commands", async (ctx) => {
  const text = commandsHelpText();
  await sendMenuPhoto(ctx, "commands", text, backHomeKeyboard());
});

bot.callbackQuery("about", async (ctx) => {
  const text = [
    "ℹ️ <b>О ГАПОУ «СЛТ»</b>",
    "",
    "Сыктывкарский лесопромышленный техникум — одно из старейших учебных заведений Республики Коми, готовящее квалифицированные кадры для лесной отрасли, ИТ-индустрии и сферы обслуживания.",
    "",
    "📍 <b>Адрес:</b> г. Сыктывкар, ул. Менделеева, д. 2/1",
    "📞 <b>Телефон:</b> 8(8212) 62-50-53",
    "🌐 <b>Сайт:</b> <a href='https://slt-online.ru'>slt-online.ru</a>",
    "",
    "Бот разработан для оперативной поддержки абитуриентов и студентов.",
  ].join("\n");
  await sendMenuPhoto(ctx, "about", text, backHomeKeyboard());
});

bot.callbackQuery("categories", async (ctx) => {
  const kb = categoriesKeyboard();
  const text = "📚 Выберите раздел, который вас интересует.";
  await sendMenuPhoto(ctx, "categories", text, kb);
});

bot.callbackQuery(/^cat_\d+$/, async (ctx) => {
  const id = parseInt(ctx.match[0].replace("cat_", ""), 10);
  const category = faqCategories.find((c) => c.id === id);
  if (!category) {
    await ctx.answerCallbackQuery();
    await ctx.reply("Категория не найдена. Попробуйте снова.");
    return;
  }
  ctx.session.lastCategoryId = id;
  const kb = questionsKeyboard(id);
  const text = `📚 Категория: <b>${category.title}</b>\nВыберите вопрос:`;
  await sendMenuPhoto(ctx, "categories", text, kb);
});

bot.callbackQuery(/^faq_\d+$/, async (ctx) => {
  const id = parseInt(ctx.match[0].replace("faq_", ""), 10);
  const item = faqQuestionsMap.get(id);
  if (!item) {
    await ctx.answerCallbackQuery();
    await ctx.reply("Вопрос не найден. Попробуйте снова.");
    return;
  }
  
  // Обновляем статистику в БД
  incrementQuestionStat(id);
  
  ctx.session.totalQuestionsViewed = (ctx.session.totalQuestionsViewed || 0) + 1;
  addRecentQuestion(ctx.from.id, id);
  
  // Проверяем избранное в БД
  const isFav = isFavorite(ctx.from.id, id);
  
  const kb = new InlineKeyboard()
    .text(isFav ? "⭐ Убрать из избранного" : "⭐ В избранное", `fav_toggle_${id}`).row()
    .text("⬅️ К вопросам раздела", `cat_${item.categoryId}`).row()
    .text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "categories", formatFaqAnswer(item), kb);
});

bot.callbackQuery("search", async (ctx) => {
  ctx.session.awaitingSearch = true;
  ctx.session.lastSearchQuery = "";
  const kb = new InlineKeyboard().text("🏠 Главное меню", "start");
  const text =
    "🔎 Поиск по вопросам\nНапишите свой вопрос одним сообщением. Например:\n\n«Какие документы нужны для поступления?»\nили\n«Во сколько начинаются занятия?»";
  await sendMenuPhoto(ctx, "search", text, kb);
});

bot.callbackQuery("stats", async (ctx) => {
  const top = getTopQuestionsDb(5);
  if (!top.length) {
    const kb = backHomeKeyboard();
    await sendMenuPhoto(ctx, "stats", "Пока статистика пуста. Задайте несколько вопросов через бот.", kb);
    return;
  }
  const lines = ["📊 Популярные вопросы:"];
  for (const item of top) {
    lines.push(`• ${item.question} (запросов: ${item.view_count})`);
  }
  const kb = new InlineKeyboard().text("📚 К категориям", "categories").row().text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "stats", lines.join("\n"), kb);
});

bot.callbackQuery(/^fav_toggle_\d+$/, async (ctx) => {
  const id = parseInt(ctx.match[0].replace("fav_toggle_", ""), 10);
  const item = faqQuestionsMap.get(id);
  if (!item) {
    await ctx.answerCallbackQuery();
    await ctx.reply("Не удалось обновить избранное. Попробуйте позже.");
    return;
  }
  
  // Переключаем избранное в БД
  const added = toggleFavorite(ctx.from.id, id);
  await ctx.answerCallbackQuery({ text: added ? "Добавлено в избранное" : "Удалено из избранного" });
  
  const isFav = isFavorite(ctx.from.id, id);
  const kb = new InlineKeyboard()
    .text(isFav ? "⭐ Убрать из избранного" : "⭐ В избранное", `fav_toggle_${id}`).row()
    .text("⬅️ К вопросам раздела", `cat_${item.categoryId}`).row()
    .text("🏠 Главное меню", "start");

  const text = formatFaqAnswer(item);
  const hasPhoto = !!ctx.callbackQuery.message.photo;

  if (hasPhoto) {
    await ctx.editMessageCaption({
      caption: text,
      reply_markup: kb,
      parse_mode: "HTML",
    }).catch(async () => {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
    });
  } else {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  }
});

bot.callbackQuery("favorites", async (ctx) => {
  const items = getFavorites(ctx.from.id);
  if (!items.length) {
    const kb = new InlineKeyboard()
      .text("📚 Вопросы по категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await sendMenuPhoto(ctx, "favorites", "У вас пока нет избранных вопросов. Добавьте любой ответ в избранное кнопкой «⭐».", kb);
    return;
  }
  const kb = new InlineKeyboard();
  for (const item of items.slice(0, 10)) {
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    const icon = getCategoryIcon(item.category_id);
    const label = `${icon} ${shortTitle}`;
    kb.text(label, `faq_${item.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "favorites", "⭐ Ваши избранные вопросы:", kb);
});

bot.callbackQuery("recent", async (ctx) => {
  const items = getRecentQuestions(ctx.from.id, 10);
  if (!items.length) {
    const kb = new InlineKeyboard()
      .text("📚 Вопросы по категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await sendMenuPhoto(ctx, "recent", "Вы ещё не просматривали ответы. Откройте любой вопрос через категории или поиск.", kb);
    return;
  }
  const kb = new InlineKeyboard();
  for (const item of items) {
    const mapItem = faqQuestionsMap.get(item.id);
    if (!mapItem) continue;
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    const icon = getCategoryIcon(item.category_id);
    const label = `${icon} ${shortTitle}`;
    kb.text(label, `faq_${item.id}`).row();
  }
  kb.text("🗑 Очистить историю", "clear_recent").row();
  kb.text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "recent", "🕒 Недавние вопросы, которые вы просматривали:", kb);
});

bot.callbackQuery("profile", async (ctx) => {
  const userId = ctx.from.id;
  const userInfo = getUserInfo(userId);
  const favorites = getFavorites(userId);
  const searches = getUserSearchCount(userId);
  const recentItems = getRecentQuestions(userId, 5);

  // Дата регистрации
  let regDate = "—";
  if (userInfo?.registered_at) {
    const d = new Date(userInfo.registered_at);
    regDate = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  const text = [
    `👤 <b>Профиль пользователя</b>`,
    `Имя: <b>${ctx.from.first_name || "—"}</b>`,
    userInfo?.username ? `Username: @${userInfo.username}` : "",
    `📅 В боте с: <b>${regDate}</b>`,
    "",
    `🔎 Поисковых запросов: <b>${searches}</b>`,
    `⭐ В избранном: <b>${favorites.length}</b>`,
    `🕒 Недавно просмотрено: <b>${recentItems.length}</b>`,
  ].filter(Boolean).join("\n");

  const kb = new InlineKeyboard()
    .text("⭐ Избранное", "favorites").row()
    .text("🕒 Недавние вопросы", "recent").row()
    .text("🗑 Очистить историю", "clear_recent").row()
    .text("📊 Популярные вопросы", "stats").row()
    .text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "profile", text, kb);
});

bot.callbackQuery("clear_recent", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "История очищена" });
  clearRecentQuestions(ctx.from.id);
  const kb = new InlineKeyboard()
    .text("👤 Профиль", "profile").row()
    .text("🏠 Главное меню", "start");
  await ctx.editMessageText("🗑 История просмотров очищена.", { reply_markup: kb }).catch(async () => {
    await ctx.reply("🗑 История просмотров очищена.", { reply_markup: kb });
  });
});

bot.on("message:text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  if (!text) return;

  const awaiting = ctx.session.awaitingSearch;
  ctx.session.awaitingSearch = false;
  ctx.session.lastSearchQuery = text;

  // Сначала пробуем Algolia если настроена, иначе — встроенный fuzzy-поиск
  let results = [];
  if (config.algoliaAppId && config.algoliaApiKey && config.algoliaIndexName) {
    results = await searchAlgoliaFaq(text, 5);
  }
  if (!results.length) {
    results = searchFaqLocal(text, 5);
  }

  // Логируем поиск в БД
  logSearch(ctx.from.id, text, results.length);

  const treatAsSearch = awaiting || results.length > 0;
  if (!results.length || !treatAsSearch) {
    const kb = new InlineKeyboard()
      .text("📚 По категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await ctx.reply(
      "По вашему запросу ничего не найдено. Попробуйте другие слова или воспользуйтесь навигацией по категориям.",
      { reply_markup: kb },
    );
    return;
  }

  const best = results[0].item;
  incrementQuestionStat(best.id);
  addRecentQuestion(ctx.from.id, best.id);
  ctx.session.totalQuestionsViewed = (ctx.session.totalQuestionsViewed || 0) + 1;

  const alternatives = results.slice(1, 4).map((r) => r.item);
  const kb = new InlineKeyboard();
  for (const alt of alternatives) {
    const shortTitle = alt.question.length > 40 ? alt.question.slice(0, 37) + "..." : alt.question;
    const icon = getCategoryIcon(alt.categoryId);
    const label = `${icon} ${shortTitle}`;
    kb.text(label, `faq_${alt.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  await ctx.reply(formatFaqAnswer(best), { reply_markup: kb, parse_mode: "HTML" });
});

bot.catch((err) => {
  console.error("Ошибка бота:", err);
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`Получен сигнал ${signal}, завершаем работу бота...`);
  try {
    await bot.stop();
    console.log("Бот остановлен.");
  } catch (e) {
    console.error("Ошибка при остановке бота:", e);
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

bot.start();
console.log("FAQ-бот запущен");