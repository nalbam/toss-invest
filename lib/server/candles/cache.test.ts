import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import type { Candle } from "@/lib/server/toss/schemas";
import {
  isConfirmedCandle,
  putConfirmedCandles,
  readCachedCandles,
  readCoverage,
  recordCoverageFetch,
} from "./cache";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function candle(timestamp: string, close = "100"): Candle {
  return {
    timestamp,
    openPrice: "100",
    highPrice: "110",
    lowPrice: "90",
    closePrice: close,
    volume: "1000",
    currency: "KRW",
  };
}

// Fixed reference instant (09:05:00Z) so confirmed/forming boundaries are
// deterministic.
const NOW = Date.parse("2026-06-18T09:05:00Z");

describe("isConfirmedCandle", () => {
  it("treats a candle whose period has fully elapsed as confirmed", () => {
    // 1m candle at 09:03 covers [09:03, 09:04); it ended before 09:05.
    expect(isConfirmedCandle("2026-06-18T09:03:00Z", "1m", NOW)).toBe(true);
  });

  it("treats the still-forming candle as unconfirmed, boundary inclusive", () => {
    // 09:05 covers [09:05, 09:06); now is 09:05 → forming.
    expect(isConfirmedCandle("2026-06-18T09:05:00Z", "1m", NOW)).toBe(false);
    // 09:04 covers [09:04, 09:05); ends exactly at now → confirmed.
    expect(isConfirmedCandle("2026-06-18T09:04:00Z", "1m", NOW)).toBe(true);
  });

  it("uses the daily period for 1d", () => {
    expect(isConfirmedCandle("2026-06-16T00:00:00Z", "1d", NOW)).toBe(true);
    // Today's daily candle is still forming.
    expect(isConfirmedCandle("2026-06-18T00:00:00Z", "1d", NOW)).toBe(false);
  });

  it("parses bare epoch-millis timestamps", () => {
    const ts = String(Date.parse("2026-06-18T09:03:00Z"));
    expect(isConfirmedCandle(ts, "1m", NOW)).toBe(true);
  });

  it("returns false for an unparseable timestamp", () => {
    expect(isConfirmedCandle("not-a-time", "1m", NOW)).toBe(false);
  });
});

describe("putConfirmedCandles / readCachedCandles", () => {
  it("stores only confirmed candles, skipping the forming one (newest-first read)", () => {
    const db = makeDb();
    const written = putConfirmedCandles(
      "005930",
      "1m",
      [
        candle("2026-06-18T09:03:00Z"),
        candle("2026-06-18T09:04:00Z"),
        candle("2026-06-18T09:05:00Z"), // forming → skipped
      ],
      NOW,
      db,
    );
    expect(written).toBe(2);
    const rows = readCachedCandles("005930", "1m", { limit: 10 }, db);
    expect(rows.map((c) => c.timestamp)).toEqual([
      "2026-06-18T09:04:00Z",
      "2026-06-18T09:03:00Z",
    ]);
  });

  it("upserts by (symbol, interval, timestamp) without duplicating", () => {
    const db = makeDb();
    putConfirmedCandles("005930", "1m", [candle("2026-06-18T09:03:00Z", "100")], NOW, db);
    putConfirmedCandles("005930", "1m", [candle("2026-06-18T09:03:00Z", "105")], NOW, db);
    const rows = readCachedCandles("005930", "1m", { limit: 10 }, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].closePrice).toBe("105");
  });

  it("isolates rows by symbol and interval", () => {
    const db = makeDb();
    putConfirmedCandles("005930", "1m", [candle("2026-06-18T09:03:00Z")], NOW, db);
    putConfirmedCandles("AAPL", "1m", [candle("2026-06-18T09:03:00Z")], NOW, db);
    putConfirmedCandles("005930", "1d", [candle("2026-06-16T00:00:00Z")], NOW, db);
    expect(readCachedCandles("005930", "1m", { limit: 10 }, db)).toHaveLength(1);
    expect(readCachedCandles("005930", "1d", { limit: 10 }, db)).toHaveLength(1);
    expect(readCachedCandles("AAPL", "1m", { limit: 10 }, db)).toHaveLength(1);
  });

  it("paginates older candles via the `before` cursor (exclusive)", () => {
    const db = makeDb();
    putConfirmedCandles(
      "005930",
      "1m",
      [
        candle("2026-06-18T09:00:00Z"),
        candle("2026-06-18T09:01:00Z"),
        candle("2026-06-18T09:02:00Z"),
        candle("2026-06-18T09:03:00Z"),
      ],
      NOW,
      db,
    );
    const older = readCachedCandles(
      "005930",
      "1m",
      { before: "2026-06-18T09:02:00Z", limit: 2 },
      db,
    );
    expect(older.map((c) => c.timestamp)).toEqual([
      "2026-06-18T09:01:00Z",
      "2026-06-18T09:00:00Z",
    ]);
  });

  it("orders by parsed instant, not lexicographically, across mixed formats", () => {
    const db = makeDb();
    const later = Date.parse("2026-06-18T11:00:00Z");
    putConfirmedCandles(
      "005930",
      "1m",
      [
        candle("2026-06-18T18:00:00+09:00"), // == 09:00Z
        candle("2026-06-18T10:00:00Z"), // later instant
      ],
      later,
      db,
    );
    const rows = readCachedCandles("005930", "1m", { limit: 10 }, db);
    expect(rows[0].timestamp).toBe("2026-06-18T10:00:00Z");
  });

  it("migrates a candle_cache table created before the currency column", () => {
    const db = new Database(":memory:");
    // Pre-currency schema, as a DB created mid-rollout would have.
    db.exec(
      `CREATE TABLE candle_cache (
         symbol TEXT NOT NULL,
         interval TEXT NOT NULL,
         timestamp TEXT NOT NULL,
         epoch_ms INTEGER NOT NULL,
         open_price TEXT NOT NULL,
         high_price TEXT NOT NULL,
         low_price TEXT NOT NULL,
         close_price TEXT NOT NULL,
         volume TEXT NOT NULL,
         cached_at TEXT NOT NULL,
         PRIMARY KEY (symbol, interval, timestamp)
       )`,
    );
    initSchema(db); // runs migrate() → adds the currency column

    // Insert no longer throws "table candle_cache has no column named currency".
    const written = putConfirmedCandles(
      "005930",
      "1m",
      [candle("2026-06-18T09:03:00Z")],
      NOW,
      db,
    );
    expect(written).toBe(1);
    expect(
      readCachedCandles("005930", "1m", { limit: 10 }, db)[0].currency,
    ).toBe("KRW");
  });
});

describe("candle_coverage", () => {
  it("returns null before any coverage is recorded", () => {
    const db = makeDb();
    expect(readCoverage("005930", "1m", db)).toBeNull();
  });

  it("a latest fetch below an existing range replaces it (a hole opened above)", () => {
    const db = makeDb();
    recordCoverageFetch("005930", "1m", { from: 100, to: 200, latest: true }, NOW, db);
    recordCoverageFetch("005930", "1m", { from: 500, to: 600, latest: true }, NOW, db);
    expect(readCoverage("005930", "1m", db)).toEqual({ from: 500, to: 600 });
  });

  it("a latest fetch overlapping the range unions it", () => {
    const db = makeDb();
    recordCoverageFetch("005930", "1m", { from: 100, to: 300, latest: true }, NOW, db);
    recordCoverageFetch("005930", "1m", { from: 250, to: 400, latest: true }, NOW, db);
    expect(readCoverage("005930", "1m", db)).toEqual({ from: 100, to: 400 });
  });

  it("an older fetch reaching the anchor bottom extends it down", () => {
    const db = makeDb();
    recordCoverageFetch("005930", "1m", { from: 300, to: 600, latest: true }, NOW, db);
    recordCoverageFetch("005930", "1m", { from: 100, to: 300, latest: false }, NOW, db);
    expect(readCoverage("005930", "1m", db)).toEqual({ from: 100, to: 600 });
  });

  it("a detached older fetch leaves the anchor intact", () => {
    const db = makeDb();
    recordCoverageFetch("005930", "1m", { from: 300, to: 600, latest: true }, NOW, db);
    recordCoverageFetch("005930", "1m", { from: 100, to: 150, latest: false }, NOW, db);
    expect(readCoverage("005930", "1m", db)).toEqual({ from: 300, to: 600 });
  });
});
