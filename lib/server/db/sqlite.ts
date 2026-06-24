import "server-only";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

// Single SQLite connection for the app's persistent advice log. The file path is
// configurable via ADVISOR_DB_PATH (default ./data/advisor.db); ":memory:" is
// used by unit tests. Schema is created idempotently on first open. All advice
// is kept indefinitely (no row cap) — this is the durable record, not a cache.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS market_advice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  chart_timestamp TEXT,
  last_price TEXT,
  decision_action TEXT NOT NULL,
  decision_label TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  advice TEXT NOT NULL,
  annotations TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_advice_lookup
  ON market_advice (symbol, interval, id DESC);

CREATE TABLE IF NOT EXISTS portfolio_advice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_seq INTEGER,
  generated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  advice TEXT NOT NULL,
  proposals TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolio_advice_lookup
  ON portfolio_advice (account_seq, id DESC);

CREATE TABLE IF NOT EXISTS advisor_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  name TEXT,
  interval TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  enabled INTEGER NOT NULL DEFAULT 1,
  run_every_minutes INTEGER NOT NULL DEFAULT 60,
  last_run_at TEXT,
  last_chart_timestamp TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(symbol, interval)
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT,
  currency TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_directory (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT,
  currency TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_directory_name ON stock_directory (name);
`;

// Additive migrations for DBs created before a column existed. SQLite lacks
// "ADD COLUMN IF NOT EXISTS", so each column is checked via PRAGMA first.
function migrate(db: Database.Database): void {
  const columns = (
    db.prepare("PRAGMA table_info(advisor_watchlist)").all() as { name: string }[]
  ).map((column) => column.name);
  if (!columns.includes("run_every_minutes")) {
    db.exec(
      "ALTER TABLE advisor_watchlist ADD COLUMN run_every_minutes INTEGER NOT NULL DEFAULT 60",
    );
  }
  if (!columns.includes("last_run_at")) {
    db.exec("ALTER TABLE advisor_watchlist ADD COLUMN last_run_at TEXT");
  }
  if (!columns.includes("last_chart_timestamp")) {
    db.exec("ALTER TABLE advisor_watchlist ADD COLUMN last_chart_timestamp TEXT");
  }
}

/** Creates the advice tables/indexes if absent. Safe to call repeatedly. */
export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA);
  migrate(db);
}

/**
 * Process-wide SQLite handle, opened (and schema-initialized) on first use.
 * Stored on `globalThis` (not a module-scoped variable) so route handlers and
 * the instrumentation-started advisor worker — which Next.js may bundle in
 * separate module registries — share ONE connection instead of opening two WAL
 * writers against the same file (mirrors the Toss client singleton).
 */
const globalForDb = globalThis as typeof globalThis & {
  __advisorDb?: Database.Database;
};

export function getDb(): Database.Database {
  if (!globalForDb.__advisorDb) {
    const path = process.env.ADVISOR_DB_PATH ?? "data/advisor.db";
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    // Wait briefly instead of throwing SQLITE_BUSY if another handle holds the
    // write lock, so watchlist writes don't fail under contention.
    db.pragma("busy_timeout = 5000");
    initSchema(db);
    globalForDb.__advisorDb = db;
  }
  return globalForDb.__advisorDb;
}

/**
 * Best-effort WAL truncate checkpoint. Passive auto-checkpoints reuse (don't
 * shrink) the WAL file, so it can sit large; a periodic TRUNCATE keeps it
 * bounded. Opportunistic — never throws into the caller.
 */
export function checkpointWal(): void {
  try {
    getDb().pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // Checkpointing is a maintenance nicety, not correctness-critical.
  }
}
