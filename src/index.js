import { Bot, InlineKeyboard, Keyboard, session, InputFile } from "grammy";
import algoliasearch from "algoliasearch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { faqCategories } from "./faqData.js";

if (!config.token) {
  console.error("TELEGRAM_TOKEN отсутствует в окружении/.env");
  process.exit(1);
}

const faqQuestionsMap = new Map();
const faqStats = new Map();
let algoliaIndex = null;
let algoliaReady = false;

function indexFaq() {
  faqQuestionsMap.clear();
  faqStats.clear();
  for (const category of faqCategories) {
    for (const item of category.items) {
      faqQuestionsMap.set(item.id, {
        ...item,
        categoryId: category.id,
        categoryTitle: category.title,
      });
      faqStats.set(item.id, 0);
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

function incrementStat(questionId) {
  if (!faqStats.has(questionId)) {
    faqStats.set(questionId, 0);
  }
  faqStats.set(questionId, faqStats.get(questionId) + 1);
}

function getTopQuestions(limit = 5) {
  const entries = Array.from(faqStats.entries());
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, limit).filter(([, count]) => count > 0);
  return top
    .map(([id, count]) => {
      const question = faqQuestionsMap.get(id);
      return { question, count };
    })
    .filter((x) => x.question);
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
    favorites: [],
    recentQuestions: [],
    totalQuestionsViewed: 0,
    totalSearches: 0,
  };
}

const bot = new Bot(config.token);
bot.use(session({ initial: initialSession }));

(async () => {
  try {
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
    `👋 Добро пожаловать в информационный бот ${config.institutionName}.`,
    "",
    "Здесь вы можете быстро найти ответы на типовые вопросы:",
    "• Поступление и документы",
    "• Сроки приёмной кампании",
    "• Расписание и обучение",
    "• Контакты и приёмная комиссия",
    "",
    "",
    "Нажмите кнопку ниже или введите вопрос текстом.",
  ].join("\n");
  await sendMenuPhoto(ctx, "home", text, startKeyboard());
});

bot.command("help", async (ctx) => {
  const text = [
    "❓ Помощь",
    "",
    "1) Нажмите «Вопросы по категориям», чтобы выбрать раздел.",
    "2) Используйте «Поиск по вопросу», чтобы написать свой вопрос текстом.",
    "3) В разделе «Популярные вопросы» отображаются самые часто задаваемые вопросы.",
    "",
    "Доступные команды:",
    "/start — главное меню.",
    "/help — эта справка.",
    "",
    "Если вы не нашли нужный ответ, попробуйте переформулировать вопрос или выбрать другую категорию.",
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
  const text =
    "ℹ️ О боте\nЭтот бот помогает абитуриентам и студентам быстро находить ответы на типовые вопросы по колледжу. База вопросов может дополняться и обновляться администрацией.";
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
  incrementStat(id);
  const s = ctx.session;
  s.totalQuestionsViewed += 1;
  if (!s.recentQuestions.includes(id)) {
    s.recentQuestions.unshift(id);
    if (s.recentQuestions.length > 10) {
      s.recentQuestions = s.recentQuestions.slice(0, 10);
    }
  }
  const isFavorite = s.favorites.includes(id);
  const kb = new InlineKeyboard()
    .text(isFavorite ? "⭐ Убрать из избранного" : "⭐ В избранное", `fav_toggle_${id}`).row()
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
  const top = getTopQuestions(5);
  if (!top.length) {
    const kb = backHomeKeyboard();
    await sendMenuPhoto(ctx, "stats", "Пока статистика пуста. Задайте несколько вопросов через бот.", kb);
    return;
  }
  const lines = ["📊 Популярные вопросы:"];
  for (const { question, count } of top) {
    lines.push(`• ${question.question} (запросов: ${count})`);
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
  const s = ctx.session;
  if (!Array.isArray(s.favorites)) {
    s.favorites = [];
  }
  if (s.favorites.includes(id)) {
    s.favorites = s.favorites.filter((x) => x !== id);
    await ctx.answerCallbackQuery({ text: "Удалено из избранного" });
  } else {
    s.favorites.push(id);
    await ctx.answerCallbackQuery({ text: "Добавлено в избранное" });
  }
  const isFavorite = s.favorites.includes(id);
  const kb = new InlineKeyboard()
    .text(isFavorite ? "⭐ Убрать из избранного" : "⭐ В избранное", `fav_toggle_${id}`).row()
    .text("⬅️ К вопросам раздела", `cat_${item.categoryId}`).row()
    .text("🏠 Главное меню", "start");
  await ctx.editMessageText(formatFaqAnswer(item), { reply_markup: kb, parse_mode: "HTML" });
});

bot.callbackQuery("favorites", async (ctx) => {
  const s = ctx.session;
  const ids = Array.isArray(s.favorites) ? s.favorites : [];
  if (!ids.length) {
    const kb = new InlineKeyboard()
      .text("📚 Вопросы по категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await sendMenuPhoto(ctx, "favorites", "У вас пока нет избранных вопросов. Добавьте любой ответ в избранное кнопкой «⭐».", kb);
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
  const favoritesCount = Array.isArray(s.favorites) ? s.favorites.length : 0;
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
  incrementStat(best.id);
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
