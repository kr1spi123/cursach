import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, "../bot_database.db");
const db = new Database(dbPath);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      icon TEXT
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY,
      category_id INTEGER,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT,
      FOREIGN KEY (category_id) REFERENCES categories (id)
    );
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER,
      question_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, question_id),
      FOREIGN KEY (user_id) REFERENCES users (telegram_id),
      FOREIGN KEY (question_id) REFERENCES questions (id)
    );
    CREATE TABLE IF NOT EXISTS statistics (
      question_id INTEGER PRIMARY KEY,
      view_count INTEGER DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions (id)
    );
    CREATE TABLE IF NOT EXISTS recent_questions (
      user_id INTEGER,
      question_id INTEGER,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, question_id),
      FOREIGN KEY (user_id) REFERENCES users (telegram_id),
      FOREIGN KEY (question_id) REFERENCES questions (id)
    );
    CREATE TABLE IF NOT EXISTS search_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      query TEXT NOT NULL,
      results_count INTEGER DEFAULT 0,
      searched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (telegram_id)
    );
  `);

  // Миграция для существующих БД: проверяем и добавляем колонки через PRAGMA
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userColumns.includes("registered_at")) {
    db.exec("ALTER TABLE users ADD COLUMN registered_at DATETIME DEFAULT CURRENT_TIMESTAMP");
    console.log("Миграция: добавлена колонка registered_at");
  }
  if (!userColumns.includes("last_viewed_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP");
    console.log("Миграция: добавлена колонка last_viewed_at");
  }

  console.log("База данных инициализирована.");
}

export function migrateFaqData(faqCategories) {
  const insertCategory = db.prepare("INSERT OR REPLACE INTO categories (id, title, icon) VALUES (?, ?, ?)");
  const insertQuestion = db.prepare("INSERT OR REPLACE INTO questions (id, category_id, question, answer, keywords) VALUES (?, ?, ?, ?, ?)");
  const transaction = db.transaction((categories) => {
    for (const cat of categories) {
      insertCategory.run(cat.id, cat.title, null);
      for (const item of cat.items) {
        insertQuestion.run(item.id, cat.id, item.question, item.answer, JSON.stringify(item.keywords || []));
      }
    }
  });
  transaction(faqCategories);
  console.log("Данные FAQ успешно мигрированы в БД.");
}

export function saveUser(telegramId, username, firstName) {
  db.prepare(`INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`).run(telegramId, username, firstName);
  db.prepare(`UPDATE users SET username = ?, first_name = ?, last_viewed_at = CURRENT_TIMESTAMP WHERE telegram_id = ?`).run(username, firstName, telegramId);
}

export function getUserInfo(telegramId) {
  return db.prepare(`SELECT telegram_id, username, first_name, registered_at, last_viewed_at FROM users WHERE telegram_id = ?`).get(telegramId);
}

export function toggleFavorite(userId, questionId) {
  const check = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND question_id = ?").get(userId, questionId);
  if (check) {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND question_id = ?").run(userId, questionId);
    return false;
  } else {
    db.prepare("INSERT INTO favorites (user_id, question_id) VALUES (?, ?)").run(userId, questionId);
    return true;
  }
}

export function getFavorites(userId) {
  return db.prepare(`
    SELECT q.* FROM questions q
    JOIN favorites f ON q.id = f.question_id
    WHERE f.user_id = ? ORDER BY f.created_at DESC
  `).all(userId);
}

export function isFavorite(userId, questionId) {
  return !!db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND question_id = ?").get(userId, questionId);
}

export function incrementQuestionStat(questionId) {
  db.prepare(`INSERT INTO statistics (question_id, view_count) VALUES (?, 1) ON CONFLICT(question_id) DO UPDATE SET view_count = view_count + 1`).run(questionId);
}

export function getTopQuestions(limit = 5) {
  return db.prepare(`SELECT q.*, s.view_count FROM questions q JOIN statistics s ON q.id = s.question_id ORDER BY s.view_count DESC LIMIT ?`).all(limit);
}

// Недавние вопросы в БД (больше не теряются при перезапуске)
export function addRecentQuestion(userId, questionId) {
  db.prepare(`INSERT OR REPLACE INTO recent_questions (user_id, question_id, viewed_at) VALUES (?, ?, CURRENT_TIMESTAMP)`).run(userId, questionId);
  // Оставляем только последние 10
  db.prepare(`
    DELETE FROM recent_questions WHERE user_id = ? AND question_id NOT IN (
      SELECT question_id FROM recent_questions WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 10
    )
  `).run(userId, userId);
}

export function getRecentQuestions(userId, limit = 10) {
  return db.prepare(`
    SELECT q.* FROM questions q
    JOIN recent_questions r ON q.id = r.question_id
    WHERE r.user_id = ? ORDER BY r.viewed_at DESC LIMIT ?
  `).all(userId, limit);
}

export function clearRecentQuestions(userId) {
  db.prepare("DELETE FROM recent_questions WHERE user_id = ?").run(userId);
}

// Логирование поисков
export function logSearch(userId, query, resultsCount) {
  db.prepare(`INSERT INTO search_log (user_id, query, results_count) VALUES (?, ?, ?)`).run(userId, query, resultsCount);
}

export function getUserSearchCount(userId) {
  return db.prepare("SELECT COUNT(*) as count FROM search_log WHERE user_id = ?").get(userId)?.count || 0;
}

export default db;