// db.js: opens the SQLite database and creates our tables.

// ---- Load SQLite: keep the ONE line that matches your Node version ----

// Option A: Node 22.13 or higher (built in, nothing to install)
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("insurance.db");

// Option B: older Node (after running: npm install better-sqlite3)
// const Database = require("better-sqlite3");
// const db = new Database("insurance.db");

// "insurance.db" is the file where all our data will live.
// If the file doesn't exist yet, SQLite creates it automatically.

// ---- Tables ----
// Each table is like a spreadsheet: columns are the fields, rows are the records.
// CREATE TABLE IF NOT EXISTS means "only create it if it isn't there yet",
// so it is safe to run every time the server starts.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,  -- unique number, SQLite counts for us
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,               -- UNIQUE: no two accounts share an email
    salt  TEXT NOT NULL,
    hash  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token   TEXT PRIMARY KEY,                 -- the random value stored in the cookie
    user_id INTEGER NOT NULL REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS policies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    premises        TEXT NOT NULL,
    effective_date  TEXT NOT NULL,
    expiration_date TEXT NOT NULL,
    premium         INTEGER NOT NULL,
    decision        TEXT NOT NULL,
    limit_amount    INTEGER NOT NULL,         -- "limit" is a reserved word in SQL, so we rename it
    aggregate_limit INTEGER NOT NULL,
    deductible      INTEGER NOT NULL,
    status          TEXT NOT NULL,
    paid            INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS claims (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_id INTEGER NOT NULL REFERENCES policies(id),
    user_id   INTEGER NOT NULL REFERENCES users(id),
    loss_date TEXT NOT NULL,
    peril     TEXT NOT NULL,
    amount    INTEGER NOT NULL,
    covered   INTEGER NOT NULL,               -- SQLite has no true/false, so 1 = yes, 0 = no
    reason    TEXT NOT NULL,
    payout    INTEGER NOT NULL,
    status    TEXT NOT NULL
  );
`);

// Add a cancellation_date column to the policies table.
// If the column already exists, SQLite throws an error, which we ignore,
// so this is safe to run every time the server starts.
try {
  db.exec("ALTER TABLE policies ADD COLUMN cancellation_date TEXT");
} catch (e) {
  // column already exists: nothing to do
}

// Let other files use the database with: const db = require("./db");
module.exports = db;

