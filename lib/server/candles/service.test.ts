import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import type { CandlePageResponse } from "@/lib/server/toss/schemas";
import type { GetCandlesParams } from "@/lib/server/toss/endpoints";
import {
  parseTimestampMs,
  putConfirmedCandles,
  readCachedCandles,
  readCoverage,
  recordCoverageFetch,
} from "./cache";
import {
  collectAdvisorCandles,
  getCandlesCached,
  type CandleFetcher,
} from "./service";

/** A Toss stub that pages back through `all` (ascending) honoring `before`, like
 *  the real endpoint (newest-first, max 200/page). Counts every upstream call. */
function pagedClient(
  all: ReturnType<typeof candle>[],
): CandleFetcher & { count: number } {
  const state = {
    count: 0,
    async getCandles(params: GetCandlesParams): Promise<CandlePageResponse> {
      state.count += 1;
      const size = params.count ?? 200;
      const cutoff =
        params.before === undefined ? Infinity : parseTimestampMs(params.before);
      const older = all.filter((c) => parseTimestampMs(c.timestamp) < cutoff);
      const page = older.slice(-size).reverse();
      const nextBefore = older.length > size ? page[page.length - 1].timestamp : null;
      return { candles: page, nextBefore };
    },
  };
  return state;
}

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

// Late enough that every 09:00–09:06 candle used by the coverage tests below is
// confirmed (start + 60s <= now), so they are all cacheable.
const NOW_LATE = Date.parse("2026-06-18T10:00:00Z");
const nowLate = () => NOW_LATE;

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
    // Warm cache now also requires recorded coverage spanning the cursor — a raw
    // putConfirmedCandles seed alone no longer counts as trusted (a hole would
    // otherwise be served silently).
    recordCoverageFetch(
      "005930",
      "1m",
      { from: parseTimestampMs("2026-06-18T09:00:00Z"), to: NOW, latest: true },
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

  it("a holed cache is not served across the gap — the missing range is fetched live", async () => {
    const db = makeDb();
    // Two cached blocks straddling a gap at 09:02–09:04.
    putConfirmedCandles(
      "005930",
      "1m",
      [candle("2026-06-18T09:00:00Z"), candle("2026-06-18T09:01:00Z")],
      NOW_LATE,
      db,
    );
    putConfirmedCandles(
      "005930",
      "1m",
      [candle("2026-06-18T09:05:00Z"), candle("2026-06-18T09:06:00Z")],
      NOW_LATE,
      db,
    );
    // Only the upper block is proven-covered.
    recordCoverageFetch(
      "005930",
      "1m",
      { from: parseTimestampMs("2026-06-18T09:05:00Z"), to: NOW_LATE, latest: true },
      NOW_LATE,
      db,
    );
    const client = stubClient([
      {
        candles: [candle("2026-06-18T09:04:00Z"), candle("2026-06-18T09:03:00Z")],
        nextBefore: "2026-06-18T09:02:00Z",
      },
    ]);

    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:05:00Z" },
      { client, db, now: nowLate },
    );

    // Cache read would return the far-side 09:01/09:00, but coverage doesn't span
    // them → live fetch of the actual missing candles instead.
    expect(client.calls).toHaveLength(1);
    expect(page.candles.map((c) => c.timestamp)).toEqual([
      "2026-06-18T09:04:00Z",
      "2026-06-18T09:03:00Z",
    ]);
  });

  it("extends coverage down through cached candles below the proven range without refetching", async () => {
    // Repro for the 0167A0 60m report: the cache held far more history than the
    // recorded coverage (e.g. from earlier sessions), so a long backfill kept
    // re-fetching every older page below cov.from even though the candles were
    // cached. An older page whose cursor sits inside coverage but that dips below
    // cov.from must be trusted and extend coverage down — no Toss call.
    const db = makeDb();
    const base = Date.parse("2026-06-18T00:00:00Z");
    const min = (n: number) => new Date(base + n * 60_000).toISOString();
    const cacheNow = base + 601 * 60_000;
    const seeded = Array.from({ length: 600 }, (_, i) => candle(min(1 + i)));
    putConfirmedCandles("0167A0", "1m", seeded, cacheNow, db); // base+1..600 cached
    // Coverage proves only the top slice (base+400..now); the lower 399 are cached
    // but unproven, as if from an earlier session.
    recordCoverageFetch(
      "0167A0",
      "1m",
      { from: parseTimestampMs(min(400)), to: cacheNow, latest: true },
      cacheNow,
      db,
    );
    const client = stubClient([]); // no Toss pages — must be served from cache

    // Older page straddling coverage's lower edge (cursor inside, page dips below).
    const page1 = await getCandlesCached(
      { symbol: "0167A0", interval: "1m", count: 200, before: min(420) },
      { client, db, now: () => cacheNow },
    );
    expect(client.calls).toHaveLength(0); // trusted cache, no Toss
    expect(page1.candles).toHaveLength(200);

    // The next older page is now within the extended coverage → still cache.
    const page2 = await getCandlesCached(
      {
        symbol: "0167A0",
        interval: "1m",
        count: 200,
        before: page1.nextBefore ?? undefined,
      },
      { client, db, now: () => cacheNow },
    );
    expect(client.calls).toHaveLength(0);
    expect(page2.candles).toHaveLength(200);
    // Coverage has been pushed down to the bottom of the walked cache.
    expect(readCoverage("0167A0", "1m", db)?.from).toBeLessThanOrEqual(
      parseTimestampMs(page2.candles[page2.candles.length - 1].timestamp),
    );
  });

  it("a contiguous covered walk is served from cache across successive older pages", async () => {
    const db = makeDb();
    putConfirmedCandles(
      "005930",
      "1m",
      [
        candle("2026-06-18T09:00:00Z"),
        candle("2026-06-18T09:01:00Z"),
        candle("2026-06-18T09:02:00Z"),
        candle("2026-06-18T09:03:00Z"),
        candle("2026-06-18T09:04:00Z"),
        candle("2026-06-18T09:05:00Z"),
      ],
      NOW_LATE,
      db,
    );
    recordCoverageFetch(
      "005930",
      "1m",
      { from: parseTimestampMs("2026-06-18T09:00:00Z"), to: NOW_LATE, latest: true },
      NOW_LATE,
      db,
    );
    const client = stubClient([]);

    await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:04:00Z" },
      { client, db, now: nowLate },
    );
    await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:02:00Z" },
      { client, db, now: nowLate },
    );

    expect(client.calls).toHaveLength(0); // both pages within coverage → cache
  });

  it("reload of the latest page fetches only the delta after a real-sized cold fetch", async () => {
    // Regression: a real latest fetch returns a full page whose newest candle is
    // still forming, so the cache holds `limit - 1` confirmed candles — never
    // `limit`. A warm gate keyed on `length >= limit` therefore never triggers
    // and every reload re-fetches the whole page. This asserts the reload is a
    // small delta instead.
    const db = makeDb();
    const base = Date.parse("2026-06-18T00:00:00Z");
    const min = (n: number) => new Date(base + n * 60_000).toISOString();
    const now1 = base + 200 * 60_000;
    // Cold latest page: 200 candles newest-first (base+200 .. base+1); base+200 is
    // forming at now1, so 199 get cached.
    const coldPage = {
      candles: Array.from({ length: 200 }, (_, i) => candle(min(200 - i))),
      nextBefore: min(0),
    };
    // The delta a warm reload should fetch (forming base+201 + a few confirmed).
    const deltaPage = {
      candles: [min(201), min(200), min(199), min(198), min(197)].map((t) =>
        candle(t),
      ),
      nextBefore: min(196),
    };
    const client = stubClient([coldPage, deltaPage]);

    await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 200 },
      { client, db, now: () => now1 },
    );
    expect(client.calls).toHaveLength(1);

    const now2 = base + 201 * 60_000;
    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 200 },
      { client, db, now: () => now2 },
    );

    // The reload must be a small delta (not a full 200-candle re-fetch).
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].before).toBeUndefined();
    expect(client.calls[1].count).toBeLessThan(200);
    // And it still returns a full, current page topped by the forming candle.
    expect(page.candles[0].timestamp).toBe(min(201));
    expect(page.candles.length).toBeGreaterThan(100);
  });

  it("latest reload after a long market-closed idle still serves from cache (bounded probe)", async () => {
    // Repro for the 0167A0 60m report: the chart's 1m source means even a few
    // hours' idle makes an elapsed-based delta balloon to a full page, so every
    // reload re-downloads everything. A market-closed reload has NO new candles,
    // so a bounded probe should adjoin the cache and serve from it.
    const db = makeDb();
    const base = Date.parse("2026-06-18T00:00:00Z");
    const min = (n: number) => new Date(base + n * 60_000).toISOString();
    const cacheNow = base + 201 * 60_000;
    const seeded = Array.from({ length: 200 }, (_, i) => candle(min(1 + i)));
    putConfirmedCandles("0167A0", "1m", seeded, cacheNow, db); // newest = base+200
    recordCoverageFetch(
      "0167A0",
      "1m",
      { from: parseTimestampMs(min(1)), to: cacheNow, latest: true },
      cacheNow,
      db,
    );

    // Reload 5 hours later. Market closed → newest is still base+200; a latest
    // fetch returns the same recent candles (no new confirmed, no forming).
    const later = base + (200 + 300) * 60_000;
    const probePage = {
      candles: Array.from({ length: 10 }, (_, i) => candle(min(200 - i))),
      nextBefore: min(190),
    };
    const fullPage = {
      candles: Array.from({ length: 200 }, (_, i) => candle(min(200 - i))),
      nextBefore: min(0),
    };
    const client = stubClient([probePage, fullPage]);

    const page = await getCandlesCached(
      { symbol: "0167A0", interval: "1m", count: 200 },
      { client, db, now: () => later },
    );

    // Must probe with a bounded count, not re-request the whole 200-candle page.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].count ?? 200).toBeLessThan(50);
    // And still return a full page from the cache.
    expect(page.candles[0].timestamp).toBe(min(200));
    expect(page.candles.length).toBeGreaterThan(100);
  });

  it("warm latest fetches only a small delta and serves the rest from cache", async () => {
    const db = makeDb();
    const base = Date.parse("2026-06-18T00:00:00Z");
    // Seed a full page (200 confirmed 1m candles, base..base+199min) + coverage,
    // as a prior latest fetch would have left it.
    const cacheNow = base + 200 * 60_000; // base+199 is confirmed (199+1<=200)
    const seeded = Array.from({ length: 200 }, (_, i) =>
      candle(new Date(base + i * 60_000).toISOString()),
    );
    putConfirmedCandles("005930", "1m", seeded, cacheNow, db);
    recordCoverageFetch(
      "005930",
      "1m",
      { from: base, to: cacheNow, latest: true },
      cacheNow,
      db,
    );

    // Two minutes later a reload asks for the latest 200. Newest cached = base+199.
    const later = base + 201 * 60_000;
    const client = stubClient([
      {
        candles: [
          candle(new Date(base + 199 * 60_000).toISOString()),
          candle(new Date(base + 200 * 60_000).toISOString()),
          candle(new Date(base + 201 * 60_000).toISOString()), // forming at `later`
        ],
        nextBefore: new Date(base + 198 * 60_000).toISOString(),
      },
    ]);

    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 200 },
      { client, db, now: () => later },
    );

    // One live call: a bounded fixed probe (LATEST_PROBE_COUNT) — NOT the full
    // 200-candle page. The confirmed remainder comes from the local cache.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].before).toBeUndefined();
    expect(client.calls[0].count).toBe(10);
    // A full page is returned, newest-first, topped by the forming candle; the
    // newly-confirmed base+200 candle is now cached too.
    expect(page.candles).toHaveLength(200);
    expect(page.candles[0].timestamp).toBe(
      new Date(base + 201 * 60_000).toISOString(),
    );
    expect(page.candles[1].timestamp).toBe(
      new Date(base + 200 * 60_000).toISOString(),
    );
    expect(
      readCachedCandles("005930", "1m", { limit: 1 }, db)[0].timestamp,
    ).toBe(new Date(base + 200 * 60_000).toISOString());
  });

  it("warm latest falls back to a full fetch when the cache is too stale to adjoin the delta", async () => {
    const db = makeDb();
    const base = Date.parse("2026-06-18T00:00:00Z");
    const cacheNow = base + 200 * 60_000;
    const seeded = Array.from({ length: 200 }, (_, i) =>
      candle(new Date(base + i * 60_000).toISOString()),
    );
    putConfirmedCandles("005930", "1m", seeded, cacheNow, db); // newest = base+199
    recordCoverageFetch(
      "005930",
      "1m",
      { from: base, to: cacheNow, latest: true },
      cacheNow,
      db,
    );

    // 300 minutes later: the delta (capped at 200) returns base+301..500, which
    // does NOT reach back to the cache's newest (base+199) → a gap would open.
    const later = base + 500 * 60_000;
    const newest200 = Array.from({ length: 200 }, (_, i) =>
      candle(new Date(base + (301 + i) * 60_000).toISOString()),
    ).reverse();
    const client = stubClient([
      { candles: newest200, nextBefore: new Date(base + 300 * 60_000).toISOString() },
      { candles: newest200, nextBefore: new Date(base + 300 * 60_000).toISOString() },
    ]);

    const page = await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 200 },
      { client, db, now: () => later },
    );

    // Delta fetch didn't adjoin the cache → fell through to a full latest fetch.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].before).toBeUndefined();
    expect(page.candles[0].timestamp).toBe(
      new Date(base + 500 * 60_000).toISOString(),
    );
  });

  it("self-heals a hole: live fetch fills and covers the gap, then re-reads from cache", async () => {
    const db = makeDb();
    // Holed state (as above): upper block cached+covered, lower block cached.
    putConfirmedCandles(
      "005930",
      "1m",
      [candle("2026-06-18T09:00:00Z"), candle("2026-06-18T09:01:00Z")],
      NOW_LATE,
      db,
    );
    putConfirmedCandles(
      "005930",
      "1m",
      [candle("2026-06-18T09:05:00Z"), candle("2026-06-18T09:06:00Z")],
      NOW_LATE,
      db,
    );
    recordCoverageFetch(
      "005930",
      "1m",
      { from: parseTimestampMs("2026-06-18T09:05:00Z"), to: NOW_LATE, latest: true },
      NOW_LATE,
      db,
    );
    // A contiguous upstream backing 09:00–09:06 (literal timestamps so cached
    // strings match the assertions exactly, not toISOString's ".000Z" form).
    const client = pagedClient([
      candle("2026-06-18T09:00:00Z"),
      candle("2026-06-18T09:01:00Z"),
      candle("2026-06-18T09:02:00Z"),
      candle("2026-06-18T09:03:00Z"),
      candle("2026-06-18T09:04:00Z"),
      candle("2026-06-18T09:05:00Z"),
      candle("2026-06-18T09:06:00Z"),
    ]);

    // First read across the hole → one live fetch that fills 09:03/09:04 and
    // extends coverage down to 09:03.
    await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:05:00Z" },
      { client, db, now: nowLate },
    );
    expect(client.count).toBe(1);
    const cachedTs = readCachedCandles("005930", "1m", { limit: 20 }, db).map(
      (c) => c.timestamp,
    );
    expect(cachedTs).toContain("2026-06-18T09:03:00Z");
    expect(cachedTs).toContain("2026-06-18T09:04:00Z");
    expect(readCoverage("005930", "1m", db)?.from).toBe(
      parseTimestampMs("2026-06-18T09:03:00Z"),
    );

    // The heal persists: the identical request now serves from cache, no new fetch.
    await getCandlesCached(
      { symbol: "005930", interval: "1m", count: 2, before: "2026-06-18T09:05:00Z" },
      { client, db, now: nowLate },
    );
    expect(client.count).toBe(1);
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

  it("reuses the DB cache: a warm re-run hits Toss only for the latest page", async () => {
    const db = makeDb();
    const base = Date.parse("2026-06-19T00:00:00Z");
    const all = Array.from({ length: 2000 }, (_, i) =>
      candle(new Date(base + i * 60_000).toISOString()),
    );
    const nowAfter = () => base + 5000 * 60_000; // every candle confirmed
    const client = pagedClient(all);

    // Cold run backfills the cache: 2000 source / 200 per page = 10 Toss calls.
    await collectAdvisorCandles("005930", "10m", { client, db, now: nowAfter });
    expect(client.count).toBe(10);

    // Warm re-run: only the latest (forming) page comes from Toss; the other
    // ~1800 confirmed candles (9 pages) are served from the local DB.
    client.count = 0;
    await collectAdvisorCandles("005930", "10m", { client, db, now: nowAfter });
    expect(client.count).toBe(1);
  });
});
