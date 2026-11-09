
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data"
);

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "kookal.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meal_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_period_id INTEGER NOT NULL REFERENCES meal_periods(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(meal_period_id,name)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL CHECK(price>=0),
  gst_rate REAL NOT NULL DEFAULT 0,
  gst_inclusive INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT DEFAULT '',
  order_type TEXT NOT NULL DEFAULT 'Dine-in',
  table_no TEXT DEFAULT '',
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL,
  grand_total REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PAID'
    CHECK(status IN ('PAID','CANCELLED')),
  cancel_reason TEXT DEFAULT '',
  cancelled_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  item_id INTEGER REFERENCES items(id),
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  gst_rate REAL NOT NULL,
  gst_amount REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Create the first administrator only when the Users table is empty.
// No default password is embedded in the source code.
const userCount = db
  .prepare("SELECT COUNT(*) AS count FROM users")
  .get() as { count: number };

if (userCount.count === 0) {
  const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;

  if (initialAdminPassword) {
    if (initialAdminPassword.length < 12) {
      throw new Error(
        "INITIAL_ADMIN_PASSWORD must contain at least 12 characters"
      );
    }

    db.prepare(`
      INSERT INTO users
        (username, full_name, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(
      "admin",
      "KOOKAL Administrator",
      bcrypt.hashSync(initialAdminPassword, 12),
      "admin"
    );
  } else {
    console.warn(
      "No administrator exists. Set INITIAL_ADMIN_PASSWORD securely to initialize one."
    );
  }
}

// Initialize default meal periods.
const periods = ["Breakfast", "Lunch", "Dinner", "High Tea"];

const addPeriod = db.prepare(
  "INSERT OR IGNORE INTO meal_periods(name) VALUES(?)"
);

periods.forEach(period => addPeriod.run(period));

// Initialize default categories.
const defaults: Record<string, string[]> = {
  Breakfast: ["Beverages", "Starters", "Main Course", "Desserts"],
  Lunch: ["Beverages", "Starters", "Main Course", "Soups", "Desserts"],
  Dinner: ["Beverages", "Starters", "Main Course", "Soups", "Desserts"],
  "High Tea": ["Beverages", "Snacks", "Starters", "Desserts"]
};

const addCategory = db.prepare(
  "INSERT OR IGNORE INTO categories(meal_period_id,name) VALUES(?,?)"
);

const getPeriod = db.prepare(
  "SELECT id FROM meal_periods WHERE name=?"
);

for (const [period, names] of Object.entries(defaults)) {
  const row = getPeriod.get(period) as { id: number } | undefined;

  if (!row) {
    throw new Error(`Meal period initialization failed: ${period}`);
  }

  names.forEach(name => addCategory.run(row.id, name));
}
