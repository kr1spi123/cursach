import { Bot, InlineKeyboard, Keyboard, session, InputFile } from "grammy";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";

if (!config.token) {
  console.error("TELEGRAM_TOKEN отсутствует в окружении/.env");
  process.exit(1);
}

const faqCategories = [
  {
    id: 1,
    title: "Поступление и подача документов",
    items: [
      {
        id: 101,
        question: "Какие документы нужны для подачи заявления?",
        answer:
          "Для подачи заявления нужны: паспорт, аттестат об образовании (оригинал или копия), СНИЛС, ИНН (при наличии), медицинская справка по форме, установленной для выбранной специальности, а также документы, подтверждающие льготы или особый статус (при наличии).",
        keywords: ["документы", "подача", "заявление", "что нужно", "список"],
      },
      {
        id: 102,
        question: "Можно ли подать документы онлайн?",
        answer:
          "Да, подать документы можно онлайн через личный кабинет абитуриента на официальном сайте " +
          (config.institutionName || "колледжа") +
          ". После регистрации и заполнения анкеты вы загружаете сканы документов, а оригиналы предоставляете в приёмную комиссию при зачислении.",
        keywords: ["онлайн", "через интернет", "личный кабинет", "подать удаленно", "электронно"],
      },
      {
        id: 103,
        question: "Нужен ли оригинал аттестата при подаче документов?",
        answer:
          "При подаче онлайн‑заявления достаточно загрузить скан или копию аттестата. Оригинал аттестата обязателен к предоставлению в приёмную комиссию перед изданием приказа о зачислении.",
        keywords: ["оригинал аттестата", "копия", "скан", "документы", "зачисление"],
      },
      {
        id: 104,
        question: "Можно ли подать заявление на несколько специальностей сразу?",
        answer:
          "Да, обычно абитуриент может подать заявление сразу на несколько специальностей. При этом формируется отдельная заявка по каждой специальности, а в конкурсных списках вы участвуете раздельно по каждому направлению.",
        keywords: ["несколько специальностей", "сколько специальностей", "одновременно", "выбор"],
      },
      {
        id: 105,
        question: "Нужно ли сдавать ЕГЭ для поступления?",
        answer:
          "Для поступления на программы СПО, как правило, достаточно результатов основного общего или среднего общего образования, без ЕГЭ. Если для конкретной специальности требуются дополнительные вступительные испытания, эта информация указывается в правилах приёма.",
        keywords: ["егэ", "экзамены", "вступительные", "нужно ли сдавать"],
      },
    ],
  },
  {
    id: 2,
    title: "Сроки приёмной кампании",
    items: [
      {
        id: 201,
        question: "Когда начинается приём документов?",
        answer:
          "Приём документов на обучение в " +
          (config.institutionName || "колледже") +
          " обычно начинается в июне. Конкретная дата начала приёма утверждается приказом директора и публикуется в разделе «Приёмная комиссия» на официальном сайте.",
        keywords: ["начало приема", "когда подать", "сроки", "даты", "прием документов"],
      },
      {
        id: 202,
        question: "До какого числа можно подать документы?",
        answer:
          "Крайний срок приёма документов зависит от формы обучения и наличия вступительных испытаний. Как правило, приём на программы СПО по очной форме завершается в конце августа, а точные даты указываются в правилах приёма и приказах приёмной комиссии.",
        keywords: ["до какого числа", "крайний срок", "последний день", "до什么时候"],
      },
      {
        id: 203,
        question: "Когда выходят приказы о зачислении?",
        answer:
          "Приказы о зачислении публикуются поэтапно по мере завершения приёмной кампании. Обычно первые приказы выходят в августе. В приказе указаны ФИО абитуриентов, специальность и форма обучения.",
        keywords: ["приказ", "зачисление", "результаты", "списки", "когда зачислят"],
      },
      {
        id: 204,
        question: "Можно ли подать документы позже установленных сроков?",
        answer:
          "После окончания установленного срока приёма документов заявления на обучение не принимаются, за исключением случаев, когда объявлен дополнительный набор. Информация о дополнительном наборе публикуется в новостях приёмной комиссии.",
        keywords: ["опоздал", "позже сроков", "дополнительный набор", "просрочил"],
      },
    ],
  },
  {
    id: 3,
    title: "Обучение и расписание",
    items: [
      {
        id: 301,
        question: "Где можно посмотреть расписание занятий?",
        answer:
          "Расписание занятий публикуется на официальном сайте " +
          (config.institutionName || "колледжа") +
          " в разделе «Расписание» и обновляется при изменениях. В большинстве случаев расписание также доступно через личный кабинет студента или информационные стенды в учебном корпусе.",
        keywords: ["расписание", "занятия", "уроки", "когда пары", "где расписание"],
      },
      {
        id: 302,
        question: "Во сколько начинаются занятия?",
        answer:
          "Как правило, первая пара начинается в 8:30. Продолжительность одной пары составляет 40–45 минут с переменами между занятиями. Точный режим работы и расписание звонков закреплены в локальных актах образовательной организации.",
        keywords: ["во сколько", "начало занятий", "первая пара", "уроки", "звонки"],
      },
      {
        id: 303,
        question: "Есть ли очно-заочная или заочная форма обучения?",
        answer:
          "Наличие очной, очно‑заочной и заочной форм обучения зависит от конкретной специальности и учебного года. Для каждой специальности в описании указывается форма обучения и срок освоения программы.",
        keywords: ["очно-заочная", "заочная", "форма обучения", "вечерняя", "очное"],
      },
      {
        id: 304,
        question: "Сколько длится обучение по специальности?",
        answer:
          "Срок обучения зависит от специальности и уровня базового образования. В среднем программы СПО для выпускников 9 классов длятся 3–4 года, а для выпускников 11 классов — 2–3 года. Конкретный срок указан в описании каждой специальности.",
        keywords: ["сколько учиться", "срок обучения", "длительность", "годы"],
      },
    ],
  },
  {
    id: 4,
    title: "Контакты и приёмная комиссия",
    items: [
      {
        id: 401,
        question: "Как связаться с приёмной комиссией?",
        answer:
          "Связаться с приёмной комиссией " +
          (config.institutionName || "колледжа") +
          " можно по телефону " +
          (config.contactPhone || "приёмной комиссии, указанному на официальном сайте") +
          " и по электронной почте " +
          (config.contactEmail || "приёмной комиссии, указанной на сайте") +
          ". В рабочее время специалисты ответят на вопросы по поступлению и документам.",
        keywords: ["контакты", "приемная комиссия", "телефон", "почта", "связаться"],
      },
      {
        id: 402,
        question: "Где находится колледж?",
        answer:
          "Колледж расположен по адресу, указанному в разделе «Контакты» на официальном сайте " +
          (config.institutionName || "колледжа") +
          ". Там же размещена схема проезда и информация о ближайших остановках общественного транспорта.",
        keywords: ["адрес", "как добраться", "где находимся", "местоположение", "проезд"],
      },
      {
        id: 403,
        question: "Какой режим работы приёмной комиссии?",
        answer:
          "В период приёмной кампании приёмная комиссия, как правило, работает по будням с утра до вечера, а в пиковые даты возможно продление работы. Точный график приёма заявлений и консультаций публикуется в разделе «Приёмная комиссия» и в новостях " +
          (config.institutionName || "колледжа") +
          ".",
        keywords: ["режим работы", "часы приема", "график", "когда открыто", "приемная"],
      },
    ],
  },
  {
    id: 5,
    title: "Заявка и личный кабинет",
    items: [
      {
        id: 501,
        question: "Как зарегистрироваться в личном кабинете абитуриента?",
        answer:
          "Для регистрации в личном кабинете абитуриента откройте официальный сайт " +
          (config.institutionName || "колледжа") +
          ", выберите раздел «Личный кабинет абитуриента», укажите адрес электронной почты, номер телефона и придумайте пароль. После подтверждения почты вы сможете зайти и заполнить анкету.",
        keywords: ["регистрация", "личный кабинет", "как зарегистрироваться", "абитуриент"],
      },
      {
        id: 502,
        question: "Как подать онлайн-заявление через личный кабинет?",
        answer:
          "После входа в личный кабинет абитуриента выберите специальность, заполните все поля анкеты, укажите сведения о предыдущем образовании и загрузите сканы обязательных документов. Затем подтвердите согласие на обработку персональных данных и отправьте заявление на рассмотрение.",
        keywords: ["подать заявление", "онлайн", "через кабинет", "заявка", "анкета"],
      },
      {
        id: 503,
        question: "Как узнать статус своей заявки?",
        answer:
          "Статус вашей заявки отображается в личном кабинете в списке поданных заявлений. Там можно увидеть, приняты ли документы, есть ли замечания, а также текущее решение приёмной комиссии по каждой выбранной специальности.",
        keywords: ["статус заявки", "проверка заявки", "проверить", "на рассмотрении", "одобрено"],
      },
      {
        id: 504,
        question: "Можно ли изменить данные в заявке после отправки?",
        answer:
          "Если вы обнаружили ошибку в уже отправленной заявке, свяжитесь с приёмной комиссией или используйте функцию редактирования заявки в личном кабинете, если она доступна. Изменения вносятся до момента принятия окончательного решения о зачислении.",
        keywords: ["исправить", "изменить заявку", "ошибка в заявке", "редактирование"],
      },
    ],
  },
  {
    id: 6,
    title: "Специальности и конкурс",
    items: [
      {
        id: 601,
        question: "Где посмотреть список специальностей?",
        answer:
          "Полный список специальностей с описанием, сроками обучения и количеством мест публикуется на официальном сайте " +
          (config.institutionName || "колледжа") +
          " в разделе «Специальности». Там же указаны требования к поступающим и возможные профили обучения.",
        keywords: ["специальности", "направления", "какие есть", "список", "профили"],
      },
      {
        id: 602,
        question: "Что такое конкурс и как формируется рейтинг абитуриентов?",
        answer:
          "Конкурс на специальность формируется по сумме конкурсных баллов абитуриентов. В рейтинг, как правило, входят баллы аттестата, результаты экзаменов (если предусмотрены) и дополнительные достижения. Абитуриенты сортируются по убыванию рейтинга, и зачисление происходит в пределах установленного количества мест.",
        keywords: ["конкурс", "рейтинг", "проходной балл", "как считают баллы"],
      },
      {
        id: 603,
        question: "Можно ли сменить выбранную специальность после подачи заявления?",
        answer:
          "До окончания приёма документов вы можете изменить перечень выбранных специальностей, подав новое заявление или обратившись в приёмную комиссию. После завершения приёмной кампании смена специальности возможна только по внутренним правилам организации и при наличии свободных мест.",
        keywords: ["сменить специальность", "передумал", "изменить выбор", "другая специальность"],
      },
      {
        id: 604,
        question: "Что такое бюджетные и платные места?",
        answer:
          "Бюджетные места финансируются за счёт средств бюджета, и обучение на них для абитуриента бесплатное. Платные места предусматривают оплату обучения по договору. Для каждой специальности устанавливается отдельное количество бюджетных и платных мест.",
        keywords: ["бюджетные места", "платное обучение", "контракт", "оплата"],
      },
    ],
  },
  {
    id: 7,
    title: "Льготы и особые категории",
    items: [
      {
        id: 701,
        question: "Какие категории абитуриентов имеют льготы при поступлении?",
        answer:
          "Льготы при поступлении могут иметь дети‑сироты и дети, оставшиеся без попечения родителей, лица с инвалидностью, а также поступающие по целевому набору и другие категории, предусмотренные законодательством и правилами приёма " +
          (config.institutionName || "колледжа") +
          ". Перечень льготных категорий указан в правилах приёма.",
        keywords: ["льготы", "особые категории", "инвалиды", "сироты", "целевой"],
      },
      {
        id: 702,
        question: "Какие документы нужны для подтверждения льготы?",
        answer:
          "Для подтверждения льготы необходимо предоставить оригиналы и копии документов, подтверждающих статус: удостоверения, справки, решения органов опеки, документы о инвалидности и другие бумаги в зависимости от категории. Конкретный перечень указан в правилах приёма.",
        keywords: ["документы льготы", "подтверждение льготы", "какие справки", "особый статус"],
      },
      {
        id: 703,
        question: "Что такое целевой приём?",
        answer:
          "Целевой приём — это поступление по договору о целевом обучении, когда абитуриент обучается по направлению конкретного предприятия или организации. После окончания обучения выпускник обязан отработать установленный срок у заказчика целевого обучения.",
        keywords: ["целевой прием", "договор о целевом обучении", "целевое", "отработка"],
      },
    ],
  },
  {
    id: 8,
    title: "Общежитие и проживание",
    items: [
      {
        id: 801,
        question: "Есть ли у колледжа общежитие для иногородних студентов?",
        answer:
          "Для иногородних студентов обычно предоставляются места в общежитии при наличии фонда проживания. Информацию о наличии общежития и количестве мест " +
          (config.institutionName || "колледж") +
          " размещает на официальном сайте и в правилах приёма.",
        keywords: ["общежитие", "общага", "жилье", "проживание", "есть ли общежитие"],
      },
      {
        id: 802,
        question: "Как подать заявление на заселение в общежитие?",
        answer:
          "Заявление на заселение в общежитие подаётся после получения рекомендации к зачислению или приказа о зачислении. Абитуриент оформляет заявление на проживание и предоставляет необходимые документы в приёмную комиссию или коменданту общежития.",
        keywords: ["заселение", "подать на общежитие", "жить в общежитии", "заявление на общежитие"],
      },
      {
        id: 803,
        question: "Платное ли проживание в общежитии?",
        answer:
          "Проживание в общежитии обычно является платным и оплачивается по установленным тарифам. Размер платы за проживание определяется локальными актами образовательной организации и указывается в договоре на проживание.",
        keywords: ["сколько стоит общежитие", "плата за общежитие", "стоимость проживания"],
      },
    ],
  },
];

const faqQuestionsMap = new Map();
const faqStats = new Map();

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter((w) => w.length > 1);
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function indexFaq() {
  faqQuestionsMap.clear();
  faqStats.clear();
  for (const category of faqCategories) {
    for (const item of category.items) {
      const normalizedQuestion = normalizeText(item.question);
      const normalizedAnswer = normalizeText(item.answer);
      const normalizedKeywords = normalizeText((item.keywords || []).join(" "));
      const questionTokens = tokenize(item.question);
      const keywordTokens = tokenize((item.keywords || []).join(" "));
      faqQuestionsMap.set(item.id, {
        ...item,
        categoryId: category.id,
        categoryTitle: category.title,
        normalizedQuestion,
        normalizedAnswer,
        normalizedKeywords,
        questionTokens,
        keywordTokens,
      });
      faqStats.set(item.id, 0);
    }
  }
}

indexFaq();

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
  return top.map(([id, count]) => {
    const question = faqQuestionsMap.get(id);
    return { question, count };
  }).filter((x) => x.question);
}

function searchLocalFaq(query) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const results = [];
  for (const item of faqQuestionsMap.values()) {
    const text = item.normalizedQuestion;
    const answer = item.normalizedAnswer;
    const keywords = item.normalizedKeywords;
    let score = 0;
    if (normalizedQuery && text.includes(normalizedQuery)) {
      score += 40;
    }
    if (normalizedQuery && keywords.includes(normalizedQuery)) {
      score += 30;
    }
    if (normalizedQuery && answer.includes(normalizedQuery)) {
      score += 10;
    }
    if (queryTokens.length) {
      for (const q of queryTokens) {
        for (const w of item.questionTokens) {
          if (w === q) {
            score += 12;
          } else if (w.startsWith(q) || q.startsWith(w)) {
            score += 6;
          } else if (w.length >= 4 && q.length >= 4 && w.includes(q)) {
            score += 4;
          } else if (w.length >= 4 && q.length >= 4) {
            const dist = editDistance(w, q);
            if (dist === 1) {
              score += 3;
            } else if (dist === 2) {
              score += 1;
            }
          }
        }
        for (const w of item.keywordTokens) {
          if (w === q) {
            score += 8;
          } else if (w.startsWith(q) || q.startsWith(w)) {
            score += 5;
          } else if (w.length >= 4 && q.length >= 4 && w.includes(q)) {
            score += 3;
          }
        }
      }
    }
    if (score > 0) {
      results.push({ item, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
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
    home: ["home", "main", "start", "banner", "главное", "старт", "баннер", "menu"],
    categories: ["menu", "list", "категории", "вопросы"],
    search: ["search", "find", "поиск", "вопрос"],
    stats: ["stats", "chart", "statistics", "статистика"],
    help: ["help", "faq", "question", "помощь", "вопрос"],
    about: ["about", "info", "о боте", "инфо", "logo"],
  };
  const p = findImageByKeywords(sectionKeywords[sectionKey] || []);
  if (p) {
    const file = new InputFile(fs.createReadStream(p));
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
    }
    await ctx.replyWithPhoto(file, { caption, reply_markup: kb, parse_mode: "HTML" });
  } else {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
    }
    await ctx.reply(caption, { reply_markup: kb, parse_mode: "HTML" });
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
    kb.text(category.title, `cat_${category.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  return kb;
}

function questionsKeyboard(categoryId) {
  const kb = new InlineKeyboard();
  const category = faqCategories.find((c) => c.id === categoryId);
  if (!category) {
    kb.text("🏠 Главное меню", "start");
    return kb;
  }
  for (const item of category.items) {
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    kb.text(shortTitle, `faq_${item.id}`).row();
  }
  kb.text("⬅️ К категориям", "categories").row().text("🏠 Главное меню", "start");
  return kb;
}

function formatFaqAnswer(item) {
  return `❓ <b>Вопрос:</b> ${item.question}\n\n💬 <b>Ответ:</b> ${item.answer}`;
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
    "Если вы не нашли нужный ответ, попробуйте переформулировать вопрос или выбрать другую категорию.",
  ].join("\n");
  await sendMenuPhoto(ctx, "help", text, backHomeKeyboard());
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
    await sendMenuPhoto(ctx, "categories", "У вас пока нет избранных вопросов. Добавьте любой ответ в избранное кнопкой «⭐».", kb);
    return;
  }
  const kb = new InlineKeyboard();
  for (const id of ids.slice(0, 10)) {
    const item = faqQuestionsMap.get(id);
    if (!item) {
      continue;
    }
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    kb.text(shortTitle, `faq_${item.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "categories", "⭐ Ваши избранные вопросы:", kb);
});

bot.callbackQuery("recent", async (ctx) => {
  const s = ctx.session;
  const ids = Array.isArray(s.recentQuestions) ? s.recentQuestions : [];
  if (!ids.length) {
    const kb = new InlineKeyboard()
      .text("📚 Вопросы по категориям", "categories").row()
      .text("🔎 Поиск по вопросу", "search").row()
      .text("🏠 Главное меню", "start");
    await sendMenuPhoto(ctx, "categories", "Вы ещё не просматривали ответы. Откройте любой вопрос через категории или поиск.", kb);
    return;
  }
  const kb = new InlineKeyboard();
  for (const id of ids.slice(0, 10)) {
    const item = faqQuestionsMap.get(id);
    if (!item) {
      continue;
    }
    const shortTitle = item.question.length > 40 ? item.question.slice(0, 37) + "..." : item.question;
    kb.text(shortTitle, `faq_${item.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  await sendMenuPhoto(ctx, "categories", "🕒 Недавние вопросы, которые вы просматривали:", kb);
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
  await sendMenuPhoto(ctx, "categories", text, kb);
});

bot.on("message:text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  if (!text) return;
  const awaiting = ctx.session.awaitingSearch;
  ctx.session.awaitingSearch = false;
  ctx.session.lastSearchQuery = text;
  const results = searchLocalFaq(text);
  const bestScore = results.length ? results[0].score : 0;
  const strongMatch = bestScore >= 15;
  const treatAsSearch = awaiting || strongMatch;
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
    kb.text(shortTitle, `faq_${alt.id}`).row();
  }
  kb.text("🏠 Главное меню", "start");
  await ctx.reply(formatFaqAnswer(best), { reply_markup: kb, parse_mode: "HTML" });
});

bot.catch((err) => {
  console.error("Ошибка бота:", err);
});

bot.start();
console.log("FAQ-бот запущен");

