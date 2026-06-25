import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import type { CandlePageResponse } from "@/lib/server/toss/schemas";
import type { GetCandlesParams } from "@/lib/server/toss/endpoints";
import { putConfirmedCandles, readCachedCandles } from "./cache";
import {
  collectAdvisorCandles,
  getCandlesCached,
  type CandleFetcher,
} from "./service";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function candle(timestamp: string, close = "100") {
  return {
    timestamp,
    openPrice: "100",
    highPrice: "110",
    lowPrice: "90",
    closePrice: close,
    volume: "1000",
    currency: "KRW" as const,
  };
}

function stubClient(
  pages: CandlePageResponse[],
): CandleFetcher & { calls: GetCandlesParams[] } {
  const calls: GetCandlesParams[] = [];
  let i = 0;
  return {
    calls,
    async getCandles(params) {
      calls.push(params);
      return pages[i++] ?? { candles: [], nextBefore: null };
    },
  };
}

const NOW = Date.parse("2026-06-18T09:05:00Z");
const now = () => NOW;

describe("getCandlesCached", () => {
  it("latest request fetches from Toss and caches only the confirmed candles", async () => {
    const db = makeDb();
    const client = stubClient([
      {
        candles: [
          candle("2026-06-18T09:03:00Z"),
          candle("2026-06-18T09:04:00Z"),
          candle("2026-06-18T09:05:00Z"), // forming
        ],
        nextBefore: "2026-06-18T09:03:00Z",
      },
    ]);

    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m" },
      { client, db, now },
    );

    expect(client.calls).toHaveLength(1);
    // Returns the live page verbatim (including the forming candle).
    expect(page.candles).toHaveLength(3);
    // Only the two confirmed candles are cached.
    const cached = readCachedCandles("005930", "1m", { limit: 10 }, db);
    expect(cached.map((c) => c.timestamp)).toEqual([
      "2026-06-18T09:04:00Z",
      "2026-06-18T09:03:00Z",
    ]);
  });

  it("older request is served from a warm cache without calling Toss", async () => {
    const db = makeDb();
    putConfirmedCandles(
      "005930",
      "1m",
      [
        candle("2026-06-18T09:00:00Z"),
        candle("2026-06-18T09:01:00Z"),
        candle("2026-06-18T09:02:00Z"),
      ],
      NOW,
      db,
    );
    const client = stubClient([]);

    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:03:00Z" },
      { client, db, now },
    );

    expect(client.calls).toHaveLength(0); // cache hit, no Toss call
    expect(page.candles.map((c) => c.timestamp)).toEqual([
      "2026-06-18T09:02:00Z",
      "2026-06-18T09:01:00Z",
    ]);
    expect(page.nextBefore).toBe("2026-06-18T09:01:00Z");
  });

  it("older request falls back to Toss on a cold cache and caches the result", async () => {
    const db = makeDb();
    const client = stubClient([
      {
        candles: [candle("2026-06-18T09:00:00Z"), candle("2026-06-18T09:01:00Z")],
        nextBefore: "2026-06-18T08:59:00Z",
      },
    ]);

    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:02:00Z" },
      { client, db, now },
    );

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({ before: "2026-06-18T09:02:00Z", count: 2 });
    expect(page.nextBefore).toBe("2026-06-18T08:59:00Z");
    // The fetched confirmed candles are now cached for next time.
    expect(readCachedCandles("005930", "1m", { limit: 10 }, db)).toHaveLength(2);
  });

  it("older request falls back to Toss when the cache holds only a partial page", async () => {
    const db = makeDb();
    putConfirmedCandles("005930", "1m", [candle("2026-06-18T09:01:00Z")], NOW, db);
    const client = stubClient([
      {
        candles: [candle("2026-06-18T09:00:00Z"), candle("2026-06-18T09:01:00Z")],
        nextBefore: null,
      },
    ]);

    await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:02:00Z" },
      { client, db, now },
    );

    expect(client.calls).toHaveLength(1); // 1 cached < count 2 → fetch
  });
});

describe("collectAdvisorCandles", () => {
  it("paginates source candles across pages and aggregates for the interval", async () => {
    const db = makeDb();
    const base = Date.parse("2026-06-19T00:00:00Z");
    const after = () => base + 700 * 60_000; // all candles confirmed
    // 600 one-minute candles, served newest-first in 3 pages of 200 (like Toss).
    const minutes = Array.from({ length: 600 }, (_, i) =>
      candle(new Date(base + i * 60_000).toISOString()),
    );
    const desc = [...minutes].reverse();
    const client = stubClient([
      { candles: desc.slice(0, 200), nextBefore: desc[199].timestamp },
      { candles: desc.slice(200, 400), nextBefore: desc[399].timestamp },
      { candles: desc.slice(400, 600), nextBefore: null },
    ]);

    const bars = await collectAdvisorCandles("005930", "5m", {
      client,
      db,
      now: after,
    });

    // Three fetches gathered 600 source candles → 120 five-minute bars, ascending.
    expect(client.calls).toHaveLength(3);
    expect(bars).toHaveLength(120);
    expect(Date.parse(bars[0].timestamp)).toBeLessThan(
      Date.parse(bars[bars.length - 1].timestamp),
    );
  });
});
