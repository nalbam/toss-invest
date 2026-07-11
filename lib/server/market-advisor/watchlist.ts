import "server-only";
import { randomUUID } from "node:crypto";
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
  /** Newest candle timestamp at the last analysis; lets the job skip when no new candle. */
  lastChartTimestamp: string | null;
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
  last_chart_timestamp: string | null;
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
    lastChartTimestamp: row.last_chart_timestamp,
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

/**
 * Atomically claims an item for this analysis pass: sets `last_run_at` to
 * `at` and stamps a fresh, single-use `run_token`, but only if the row's
 * `last_run_at` still matches `expectedLastRunAt` (the value read when the
 * caller decided the item was due). Returns the claim token on success — pass
 * it to `touchWatchlistRun` to complete the run — or null if the claim was
 * lost.
 *
 * This guards against the in-process background worker and an external
 * `POST /api/advisor-jobs/run` trigger racing each other: both read the
 * watchlist, both see the same item as due (its `last_run_at` only advances
 * once the LLM call finishes), and without this compare-and-set both would
 * analyze it and record duplicate advice. Whichever pass claims first wins;
 * the other observes 0 rows changed (the value moved) and skips the item.
 *
 * A later pass can still win a *subsequent* claim on the same row if this
 * pass's analysis outlives the item's `run_every_minutes` window — by then
 * `last_run_at` already holds this pass's claim time, so a later reader sees
 * it as due again before this pass reaches `touchWatchlistRun`. `run_token`
 * guards the fallout of that: the completion write only applies while this
 * pass's token still owns the row, so a stale pass that lost a later claim
 * cannot overwrite state the newer pass already wrote.
 */
export function claimWatchlistRun(
  id: number,
  expectedLastRunAt: string | null,
  at: string,
  db: Database.Database = getDb(),
): string | null {
  const token = randomUUID();
  const result = db
    .prepare(
      "UPDATE advisor_watchlist SET last_run_at = ?, run_token = ? WHERE id = ? AND last_run_at IS ?",
    )
    .run(at, token, id, expectedLastRunAt);
  return result.changes > 0 ? token : null;
}

/**
 * Records when an item was last analyzed (drives the due check) and the newest
 * candle timestamp seen (drives the "no new candle → skip" check). Pass the
 * unchanged chart timestamp when skipping so only `last_run_at` advances.
 *
 * Only applies while `token` (from the matching `claimWatchlistRun`) still
 * owns the row: if a later pass has since re-claimed the item, `run_token`
 * has moved on and this write is silently skipped instead of overwriting the
 * newer pass's state. Clears `run_token` on success, releasing the claim.
 */
export function touchWatchlistRun(
  id: number,
  token: string,
  at: string,
  chartTimestamp: string | null,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    "UPDATE advisor_watchlist SET last_run_at = ?, last_chart_timestamp = ?, run_token = NULL WHERE id = ? AND run_token = ?",
  ).run(at, chartTimestamp, id, token);
}
