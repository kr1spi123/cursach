import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, "../bot_database.db");
const db = new Database(dbPath);

// Инициализация таблиц
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
  `);
  console.log("База данных инициализирована.");
}

// Миграция данных из JS файла в БД
export function migrateFaqData(faqCategories) {
  const insertCategory = db.prepare("INSERT OR REPLACE INTO categories (id, title, icon) VALUES (?, ?, ?)");
  const insertQuestion = db.prepare("INSERT OR REPLACE INTO questions (id, category_id, question, answer, keywords) VALUES (?, ?, ?, ?, ?)");

  const transaction = db.transaction((categories) => {
    for (const cat of categories) {
      insertCategory.run(cat.id, cat.title, null); // Иконки пока не в БД
      for (const item of cat.items) {
        insertQuestion.run(
          item.id,
          cat.id,
          item.question,
          item.answer,
          JSON.stringify(item.keywords || [])
        );
      }
    }
  });

  transaction(faqCategories);
  console.log("Данные FAQ успешно мигрированы в БД.");
}

// Работа с пользователями
export function saveUser(telegramId, username, firstName) {
  const stmt = db.prepare("INSERT OR REPLACE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)");
  stmt.run(telegramId, username, firstName);
}

// Работа с избранным
export function toggleFavorite(userId, questionId) {
  const check = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND question_id = ?").get(userId, questionId);
  if (check) {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND question_id = ?").run(userId, questionId);
    return false; // Удалено
  } else {
    db.prepare("INSERT INTO favorites (user_id, question_id) VALUES (?, ?)").run(userId, questionId);
    return true; // Добавлено
  }
}

export function getFavorites(userId) {
  return db.prepare(`
    SELECT q.* FROM questions q
    JOIN favorites f ON q.id = f.question_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);
}

export function isFavorite(userId, questionId) {
  const res = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND question_id = ?").get(userId, questionId);
  return !!res;
}

// Работа со статистикой
export function incrementQuestionStat(questionId) {
  db.prepare(`
    INSERT INTO statistics (question_id, view_count) 
    VALUES (?, 1) 
    ON CONFLICT(question_id) DO UPDATE SET view_count = view_count + 1
  `).run(questionId);
}

export function getTopQuestions(limit = 5) {
  return db.prepare(`
    SELECT q.*, s.view_count FROM questions q
    JOIN statistics s ON q.id = s.question_id
    ORDER BY s.view_count DESC
    LIMIT ?
  `).all(limit);
}

export default db;
