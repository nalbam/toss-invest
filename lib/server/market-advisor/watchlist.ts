import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";

// User-configured set of {symbol, interval} the background advisor job analyzes.
// Backed by SQLite (advisor_watchlist). Unlike the best-effort advice log, these
// are explicit user settings, so write failures surface to the caller.

export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string | null;
  interval: string;
  currency: string;
  enabled: boolean;
  runEveryMinutes: number;
  lastRunAt: string | null;
}

interface WatchlistRow {
  id: number;
  symbol: string;
  name: string | null;
  interval: string;
  currency: string;
  enabled: number;
  run_every_minutes: number;
  last_run_at: string | null;
  created_at: string;
}

function rowToItem(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    interval: row.interval,
    currency: row.currency,
    enabled: row.enabled === 1,
    runEveryMinutes: row.run_every_minutes,
    lastRunAt: row.last_run_at,
  };
}

export function listWatchlist(db: Database.Database = getDb()): WatchlistItem[] {
  const rows = db
    .prepare("SELECT * FROM advisor_watchlist ORDER BY id ASC")
    .all();
  return (rows as WatchlistRow[]).map(rowToItem);
}

export function listEnabledWatchlist(
  db: Database.Database = getDb(),
): WatchlistItem[] {
  const rows = db
    .prepare("SELECT * FROM advisor_watchlist WHERE enabled = 1 ORDER BY id ASC")
    .all();
  return (rows as WatchlistRow[]).map(rowToItem);
}

export interface AddWatchlistInput {
  symbol: string;
  name?: string;
  interval: string;
  currency?: string;
  runEveryMinutes?: number;
}

/** Adds an item; re-adding the same (symbol, interval) updates name/currency/period and re-enables it. */
export function addWatchlist(
  input: AddWatchlistInput,
  db: Database.Database = getDb(),
): WatchlistItem {
  const row = db
    .prepare(
      `INSERT INTO advisor_watchlist
        (symbol, name, interval, currency, enabled, run_every_minutes, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(symbol, interval)
         DO UPDATE SET name = excluded.name, currency = excluded.currency,
           run_every_minutes = excluded.run_every_minutes, enabled = 1
       RETURNING *`,
    )
    .get(
      input.symbol,
      input.name ?? null,
      input.interval,
      input.currency ?? "KRW",
      input.runEveryMinutes ?? 60,
      new Date().toISOString(),
    );
  return rowToItem(row as WatchlistRow);
}

export function removeWatchlist(id: number, db: Database.Database = getDb()): void {
  db.prepare("DELETE FROM advisor_watchlist WHERE id = ?").run(id);
}

export function setWatchlistEnabled(
  id: number,
  enabled: boolean,
  db: Database.Database = getDb(),
): void {
  db.prepare("UPDATE advisor_watchlist SET enabled = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    id,
  );
}

export function setWatchlistRunEvery(
  id: number,
  runEveryMinutes: number,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    "UPDATE advisor_watchlist SET run_every_minutes = ? WHERE id = ?",
  ).run(runEveryMinutes, id);
}

/** Records the time an item was last analyzed (drives the per-item due check). */
export function touchWatchlistRun(
  id: number,
  at: string,
  db: Database.Database = getDb(),
): void {
  db.prepare("UPDATE advisor_watchlist SET last_run_at = ? WHERE id = ?").run(
    at,
    id,
  );
}
