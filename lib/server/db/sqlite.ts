import "server-only";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

// Single SQLite connection for the app's persistent store. The file path is
// configurable via ADVISOR_DB_PATH (default ./data/advisor.db); ":memory:" is
// used by unit tests. Schema is created idempotently on first open. Advice is
// kept indefinitely (no row cap) as the durable record; candle_cache additionally
// stores confirmed (closed) candles so historical chart/advisor reads avoid
// re-fetching from Toss (the still-forming candle is never cached).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS market_advice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  chart_timestamp TEXT,
  chart_from TEXT,
  candle_count INTEGER,
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

CREATE TABLE IF NOT EXISTS candle_cache (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  epoch_ms INTEGER NOT NULL,
  open_price TEXT NOT NULL,
  high_price TEXT NOT NULL,
  low_price TEXT NOT NULL,
  close_price TEXT NOT NULL,
  volume TEXT NOT NULL,
  currency TEXT NOT NULL,
  cached_at TEXT NOT NULL,
  PRIMARY KEY (symbol, interval, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_candle_cache_range
  ON candle_cache (symbol, interval, epoch_ms DESC);

-- Disjoint proven-fetched windows (per symbol/interval) that have actually been
-- fetched from Toss. candle_cache alone cannot distinguish a real hole from a
-- legitimate market-hours gap, so a cache read is only trusted when its whole
-- window fits inside ONE proven range; anything outside falls back to a live
-- fetch. A fetch that overlaps/adjoins existing ranges merges them; detached
-- ranges persist as separate islands so proven history is never dropped.
CREATE TABLE IF NOT EXISTS candle_coverage (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  covered_from_epoch INTEGER NOT NULL,
  covered_to_epoch INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, interval, covered_from_epoch)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasons TEXT NOT NULL,
  account_seq TEXT NOT NULL,
  symbol TEXT,
  order_id TEXT,
  notional_krw REAL,
  high_value INTEGER NOT NULL,
  entry TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_audit_lookup
  ON trading_audit (at DESC);
`;

// Additive migrations for DBs created before a column existed. SQLite lacks
// "ADD COLUMN IF NOT EXISTS", so each column is checked via PRAGMA first. The
// whole pass runs in one transaction so a mid-migration failure (e.g. during
// the candle_coverage rebuild below) rolls back instead of leaving the schema
// half-migrated (a dropped old table alongside a partially populated new one).
function migrate(db: Database.Database): void {
  db.transaction(() => migrateInner(db))();
}

function migrateInner(db: Database.Database): void {
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

  // candle_cache.currency was added after the table first shipped. A NOT NULL
  // added column needs a default; 'KRW' is harmless since candle_cache is a
  // cache — any pre-existing row self-heals to its real currency on the next
  // confirmed fetch (upsert).
  const candleColumns = (
    db.prepare("PRAGMA table_info(candle_cache)").all() as { name: string }[]
  ).map((column) => column.name);
  if (!candleColumns.includes("currency")) {
    db.exec(
      "ALTER TABLE candle_cache ADD COLUMN currency TEXT NOT NULL DEFAULT 'KRW'",
    );
  }

  // candle_coverage originally held one range per (symbol, interval) with PK
  // (symbol, interval); it now holds multiple disjoint ranges keyed by
  // (symbol, interval, covered_from_epoch). SQLite cannot alter a primary key,
  // so an old-shape table is rebuilt in place, keeping its rows (each becomes
  // the first range of its symbol/interval).
  const coveragePkColumns = (
    db.prepare("PRAGMA table_info(candle_coverage)").all() as {
      name: string;
      pk: number;
    }[]
  ).filter((column) => column.pk > 0);
  if (!coveragePkColumns.some((c) => c.name === "covered_from_epoch")) {
    db.exec(`
      ALTER TABLE candle_coverage RENAME TO candle_coverage_old;
      CREATE TABLE candle_coverage (
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        covered_from_epoch INTEGER NOT NULL,
        covered_to_epoch INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (symbol, interval, covered_from_epoch)
      );
      INSERT INTO candle_coverage
        SELECT symbol, interval, covered_from_epoch, covered_to_epoch, updated_at
        FROM candle_coverage_old;
      DROP TABLE candle_coverage_old;
    `);
  }

  // market_advice gained the analyzed-window columns after first ship.
  const adviceColumns = (
    db.prepare("PRAGMA table_info(market_advice)").all() as { name: string }[]
  ).map((column) => column.name);
  if (!adviceColumns.includes("chart_from")) {
    db.exec("ALTER TABLE market_advice ADD COLUMN chart_from TEXT");
  }
  if (!adviceColumns.includes("candle_count")) {
    db.exec("ALTER TABLE market_advice ADD COLUMN candle_count INTEGER");
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
