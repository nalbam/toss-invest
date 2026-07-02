// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GetCandlesParams } from "@/lib/server/toss/endpoints";
import type { CandlePageResponse } from "@/lib/server/toss/schemas";

// Integration test for the candle route end-to-end (route → service → real
// SQLite cache). The still-forming-candle logic keys off Date.now, so fake
// timers pin "now" per request. An in-memory DB keeps it off the real file.
process.env.ADVISOR_DB_PATH = ":memory:";

const getCandles = vi.fn<(p: GetCandlesParams) => Promise<CandlePageResponse>>();

// Auth is exercised in with-auth.test; here it passes through so the test
// focuses on the caching behavior.
vi.mock("@/lib/server/auth/with-auth", () => ({
  withAuth:
    (handler: (request: Request) => Promise<Response>) =>
    (request: Request) =>
      handler(request),
}));
vi.mock("@/lib/server/toss/container", () => ({
  getServerTossClient: () => ({ getCandles }),
}));

import { getDb } from "@/lib/server/db/sqlite";
import { GET } from "./route";

const base = Date.parse("2026-06-18T00:00:00Z");
const min = (n: number) => new Date(base + n * 60_000).toISOString();

function candle(timestamp: string) {
  return {
    timestamp,
    openPrice: "100",
    highPrice: "110",
    lowPrice: "90",
    closePrice: "105",
    volume: "1000",
    currency: "KRW" as const,
  };
}

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  getCandles.mockReset();
  const db = getDb();
  db.prepare("DELETE FROM candle_cache").run();
  db.prepare("DELETE FROM candle_coverage").run();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/candles (cache-backed)", () => {
  it("caches the first latest fetch, then serves a reload from cache + delta", async () => {
    // First load at base+200min: a full 200-candle latest page whose newest
    // (base+200) is still forming → 199 confirmed get cached.
    vi.setSystemTime(base + 200 * 60_000);
    getCandles.mockResolvedValueOnce({
      candles: Array.from({ length: 200 }, (_, i) => candle(min(200 - i))),
      nextBefore: min(0),
    });

    const res1 = await GET(req("/api/candles?symbol=005930&interval=1m"));
    expect(res1.status).toBe(200);
    expect(getCandles).toHaveBeenCalledTimes(1);
    // Cold: a full page (no cursor, no delta cap).
    expect(getCandles.mock.calls[0][0].before).toBeUndefined();

    // Reload one minute later. The confirmed candles are cached, so Toss is hit
    // only for the delta — NOT the whole page again.
    vi.setSystemTime(base + 201 * 60_000);
    getCandles.mockResolvedValueOnce({
      candles: [min(201), min(200), min(199), min(198), min(197)].map(candle),
      nextBefore: min(196),
    });

    const res2 = await GET(req("/api/candles?symbol=005930&interval=1m"));
    expect(res2.status).toBe(200);
    expect(getCandles).toHaveBeenCalledTimes(2);
    // The reload is a small delta fetch, not a 200-candle re-download.
    expect(getCandles.mock.calls[1][0].before).toBeUndefined();
    expect(getCandles.mock.calls[1][0].count ?? 200).toBeLessThan(200);

    // The response is a full, current page: forming candle on top, no holes.
    const body = await res2.json();
    const ts: string[] = body.data.candles.map((c: { timestamp: string }) => c.timestamp);
    expect(ts[0]).toBe(min(201));
    expect(ts.length).toBeGreaterThan(100);
    // Contiguous (no gaps) across the returned window.
    for (let i = 1; i < ts.length; i += 1) {
      expect(Date.parse(ts[i - 1]) - Date.parse(ts[i])).toBe(60_000);
    }
  });
});
