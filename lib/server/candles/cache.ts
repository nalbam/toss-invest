import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";
import type { Candle } from "@/lib/server/toss/schemas";

// Local cache of confirmed (closed) candles, backed by SQLite (candle_cache).
// Only candles whose period has fully elapsed are stored — the still-forming
// candle is always read live from Toss, never cached — so historical chart and
// advisor reads can be served from the cache without re-hitting the API.

export type SourceInterval = "1m" | "1d";

/** Length of one candle period, in milliseconds, per source interval. */
const INTERVAL_MS: Record<SourceInterval, number> = {
  "1m": 60_000,
  "1d": 86_400_000,
};

/**
 * Parses a candle timestamp to epoch milliseconds, accepting both ISO 8601
 * (with or without an offset) and a bare epoch-millis integer string. Returns
 * NaN when unparseable. Used for both the confirmed-period test and the stored
 * `epoch_ms` sort key so mixed formats still order chronologically.
 */
export function parseTimestampMs(timestamp: string): number {
  if (/^\d+$/.test(timestamp)) {
    return Number(timestamp);
  }
  return Date.parse(timestamp);
}

/**
 * A candle covering [timestamp, timestamp + interval) is "confirmed" (final,
 * safe to cache) once its period has fully elapsed: start + intervalMs <= now.
 * The still-forming candle (period straddles now) is never confirmed — it must
 * be read live from Toss. An unparseable timestamp is treated as unconfirmed
 * (fail-safe: never cache something we can't place in time).
 */
export function isConfirmedCandle(
  timestamp: string,
  interval: SourceInterval,
  nowMs: number,
): boolean {
  const start = parseTimestampMs(timestamp);
  if (Number.isNaN(start)) {
    return false;
  }
  return start + INTERVAL_MS[interval] <= nowMs;
}

interface CandleRow {
  timestamp: string;
  open_price: string;
  high_price: string;
  low_price: string;
  close_price: string;
  volume: string;
  currency: string;
}

function rowToCandle(row: CandleRow): Candle {
  return {
    timestamp: row.timestamp,
    openPrice: row.open_price,
    highPrice: row.high_price,
    lowPrice: row.low_price,
    closePrice: row.close_price,
    volume: row.volume,
    currency: row.currency,
  };
}

/**
 * Upserts confirmed candles into the cache, keyed by (symbol, interval,
 * timestamp). Candles that are still forming (per `isConfirmedCandle`) or carry
 * an unparseable timestamp are skipped so the cache never holds provisional
 * data. Returns the number of rows written.
 */
export function putConfirmedCandles(
  symbol: string,
  interval: SourceInterval,
  candles: Candle[],
  nowMs: number,
  db: Database.Database = getDb(),
): number {
  const cachedAt = new Date(nowMs).toISOString();
  const stmt = db.prepare(
    `INSERT INTO candle_cache
       (symbol, interval, timestamp, epoch_ms, open_price, high_price, low_price, close_price, volume, currency, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, interval, timestamp) DO UPDATE SET
       epoch_ms = excluded.epoch_ms,
       open_price = excluded.open_price,
       high_price = excluded.high_price,
       low_price = excluded.low_price,
       close_price = excluded.close_price,
       volume = excluded.volume,
       currency = excluded.currency,
       cached_at = excluded.cached_at`,
  );
  const writeAll = db.transaction((rows: Candle[]) => {
    let count = 0;
    for (const c of rows) {
      if (!isConfirmedCandle(c.timestamp, interval, nowMs)) {
        continue;
      }
      stmt.run(
        symbol,
        interval,
        c.timestamp,
        parseTimestampMs(c.timestamp),
        c.openPrice,
        c.highPrice,
        c.lowPrice,
        c.closePrice,
        c.volume,
        c.currency,
        cachedAt,
      );
      count += 1;
    }
    return count;
  });
  return writeAll(candles);
}

export interface ReadCandlesOptions {
  /** Only candles strictly older than this instant (time-descending cursor). */
  before?: string;
  /** Maximum number of candles to return. */
  limit: number;
}

/**
 * Reads cached candles for a symbol/interval in time-descending order (newest
 * first, mirroring Toss). With `before`, only candles strictly older than that
 * instant are returned. Ordering and the cursor compare parsed epoch time, so
 * mixed timestamp formats still sort chronologically.
 */
export function readCachedCandles(
  symbol: string,
  interval: SourceInterval,
  options: ReadCandlesOptions,
  db: Database.Database = getDb(),
): Candle[] {
  const rows =
    options.before === undefined
      ? db
          .prepare(
            `SELECT * FROM candle_cache
             WHERE symbol = ? AND interval = ?
             ORDER BY epoch_ms DESC LIMIT ?`,
          )
          .all(symbol, interval, options.limit)
      : db
          .prepare(
            `SELECT * FROM candle_cache
             WHERE symbol = ? AND interval = ? AND epoch_ms < ?
             ORDER BY epoch_ms DESC LIMIT ?`,
          )
          .all(symbol, interval, parseTimestampMs(options.before), options.limit);
  return (rows as CandleRow[]).map(rowToCandle);
}

/** Proven-fetched epoch window (inclusive) for a symbol/interval — the only range
 *  in which cached candles are trusted as gap-free. See `candle_coverage`. */
export interface Coverage {
  from: number;
  to: number;
}

interface CoverageRow {
  covered_from_epoch: number;
  covered_to_epoch: number;
}

/** Reads the recorded coverage range, or `null` when none has been fetched yet. */
export function readCoverage(
  symbol: string,
  interval: SourceInterval,
  db: Database.Database = getDb(),
): Coverage | null {
  const row = db
    .prepare(
      `SELECT covered_from_epoch, covered_to_epoch FROM candle_coverage
       WHERE symbol = ? AND interval = ?`,
    )
    .get(symbol, interval) as CoverageRow | undefined;
  if (row === undefined) {
    return null;
  }
  return { from: row.covered_from_epoch, to: row.covered_to_epoch };
}

/**
 * Merges a real Toss fetch's window into the single latest-anchored coverage
 * range. `fetched.to` is `nowMs` for a latest fetch (before undefined — proves
 * every confirmed candle up to now is held) or the request cursor for an older
 * fetch. Merge is driven by the cursor, not epoch adjacency, so a legitimate
 * weekend/holiday gap inside a contiguous walk still counts as covered:
 *   - latest: overlaps/touches the anchor => union; a gap below the new latest
 *     means a hole opened above the old range => REPLACE (drop the stale island).
 *   - older: cursor reaches the anchor's bottom (`to >= existing.from`) => extend
 *     down; a fully-detached older fetch leaves the anchor intact.
 * Never called from `putConfirmedCandles` — coverage is only ever established by
 * an actual upstream fetch.
 */
export function recordCoverageFetch(
  symbol: string,
  interval: SourceInterval,
  fetched: { from: number; to: number; latest: boolean },
  nowMs: number,
  db: Database.Database = getDb(),
): void {
  const existing = readCoverage(symbol, interval, db);
  let next: Coverage;
  if (fetched.latest) {
    if (existing === null || fetched.from <= existing.to) {
      next = existing === null ? fetched : merge(existing, fetched);
    } else {
      next = fetched;
    }
  } else if (existing === null) {
    next = fetched;
  } else if (fetched.to >= existing.from) {
    next = merge(existing, fetched);
  } else {
    next = existing;
  }
  db.prepare(
    `INSERT INTO candle_coverage
       (symbol, interval, covered_from_epoch, covered_to_epoch, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(symbol, interval) DO UPDATE SET
       covered_from_epoch = excluded.covered_from_epoch,
       covered_to_epoch = excluded.covered_to_epoch,
       updated_at = excluded.updated_at`,
  ).run(symbol, interval, next.from, next.to, new Date(nowMs).toISOString());
}

function merge(a: Coverage, b: Coverage): Coverage {
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
}
