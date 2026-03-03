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
  toggleFavorite, 
  getFavorites, 
  isFavorite, 
  incrementQuestionStat, 
  getTopQuestions as getTopQuestionsDb 
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
  
  const s = ctx.session;
  s.totalQuestionsViewed += 1;
  if (!s.recentQuestions.includes(id)) {
    s.recentQuestions.unshift(id);
    if (s.recentQuestions.length > 10) {
      s.recentQuestions = s.recentQuestions.slice(0, 10);
    }
  }
  
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
  const s = ctx.session;
  const ids = Array.isArray(s.recentQuestions) ? s.recentQuestions : [];
  if (!ids.length) {
    const kb = new InlineKeyboard()
      .text("📚 Вопросы по категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await sendMenuPhoto(ctx, "recent", "Вы ещё не просматривали ответы. Откройте любой вопрос через категории или поиск.", kb);
    return;
  }
  const kb = new InlineKeyboard();
  for (const id of ids.slice(0, 10)) {
    const item = faqQuestionsMap.get(id);
    if (!item) {
      continue;
    }
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    const icon = getCategoryIcon(item.categoryId);
    const label = `${icon} ${shortTitle}`;
    kb.text(label, `faq_${item.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "recent", "🕒 Недавние вопросы, которые вы просматривали:", kb);
});

bot.callbackQuery("profile", async (ctx) => {
  const s = ctx.session;
  const totalViewed = s.totalQuestionsViewed || 0;
  const searches = s.totalSearches || 0;
  const favorites = getFavorites(ctx.from.id);
  const favoritesCount = favorites.length;
  
  const text = [
    "👤 Профиль пользователя",
    "",
    `📖 Просмотрено ответов: <b>${totalViewed}</b>`,
    `🔎 Поисковых запросов: <b>${searches}</b>`,
    `⭐ В избранном вопросов: <b>${favoritesCount}</b>`,
  ].join("\n");
  const kb = new InlineKeyboard()
    .text("⭐ Избранное", "favorites").row()
    .text("📊 Популярные вопросы", "stats").row()
    .text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "profile", text, kb);
});

bot.on("message:text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  if (!text) return;
  
  const awaiting = ctx.session.awaitingSearch;
  ctx.session.awaitingSearch = false;
  ctx.session.lastSearchQuery = text;
  if (!config.algoliaAppId || !config.algoliaApiKey || !config.algoliaIndexName) {
    const kb = new InlineKeyboard()
      .text("📚 По категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await ctx.reply(
      "Поиск по вопросам через Algolia пока не настроен. Обратитесь к администратору или используйте навигацию по категориям.",
      { reply_markup: kb },
    );
    return;
  }
  const results = await searchAlgoliaFaq(text, 5);
  const treatAsSearch = awaiting || results.length > 0;
  if (!results.length || !treatAsSearch) {
    const kb = new InlineKeyboard()
      .text("📚 По категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await ctx.reply(
      "Я могу помочь с типовыми вопросами. Выберите действие в меню или нажмите «Поиск по вопросу».",
      {
        reply_markup: kb,
      },
    );
    return;
  }
  ctx.session.totalSearches = (ctx.session.totalSearches || 0) + 1;
  const best = results[0].item;
  
  // Обновляем статистику в БД
  incrementQuestionStat(best.id);
  
  const s = ctx.session;
  s.totalQuestionsViewed += 1;
  if (!s.recentQuestions.includes(best.id)) {
    s.recentQuestions.unshift(best.id);
    if (s.recentQuestions.length > 10) {
      s.recentQuestions = s.recentQuestions.slice(0, 10);
    }
  }
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

bot.start();
console.log("FAQ-бот запущен");
