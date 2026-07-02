import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, LlmProvider } from "@/lib/server/llm/types";
import type { ServerTossClient } from "@/lib/server/toss/container";

// The job now reads candles through the SQLite-backed cache; use an in-memory DB
// so the test never touches the real data/advisor.db.
process.env.ADVISOR_DB_PATH = ":memory:";

const { listEnabledWatchlist, touchWatchlistRun, recordMarketAdvice } = vi.hoisted(() => ({
  listEnabledWatchlist: vi.fn(),
  touchWatchlistRun: vi.fn(),
  recordMarketAdvice: vi.fn(),
}));

vi.mock("./watchlist", () => ({ listEnabledWatchlist, touchWatchlistRun }));
vi.mock("./history", () => ({ recordMarketAdvice }));

import { getDb } from "@/lib/server/db/sqlite";
import { runAdvisorJobsOnce } from "./jobs";

// The candle cache is a process-wide singleton (shared :memory: DB). Clear it
// between tests so each starts cold — otherwise a warm cache left by a prior
// test changes how many times / with what args the job fetches candles.
beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM candle_cache").run();
  db.prepare("DELETE FROM candle_coverage").run();
});

function candle(timestamp: string) {
  return {
    timestamp,
    openPrice: "100",
    highPrice: "110",
    lowPrice: "95",
    closePrice: "105",
    volume: "1000",
    currency: "KRW",
  };
}

const validOutput = JSON.stringify({
  advice: "x",
  decision: { action: "sell", label: "l", reason: "r" },
  annotations: { supportLevels: [], resistanceLevels: [], markers: [] },
});

function stubProvider(): LlmProvider {
  return {
    name: "openai",
    chat: vi.fn(async () => ({
      content: validOutput,
      model: "stub",
    })),
  };
}

/** Provider that records each call's messages so prompt contents can be asserted. */
function capturingProvider(): { provider: LlmProvider; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    provider: {
      name: "openai",
      chat: vi.fn(async (request) => {
        calls.push(request.messages);
        return { content: validOutput, model: "stub" };
      }),
    },
  };
}

function userContent(messages: ChatMessage[]): string {
  return messages.find((message) => message.role === "user")?.content ?? "";
}

const item = (symbol: string, id: number) => ({
  id,
  symbol,
  name: null,
  interval: "1d",
  currency: "USD",
  enabled: true,
  runEveryMinutes: 60,
  lastRunAt: null,
  lastChartTimestamp: null,
});

describe("runAdvisorJobsOnce", () => {
  it("analyzes each enabled item and records the result", async () => {
    listEnabledWatchlist.mockReturnValue([item("SOXL", 1)]);
    const client = {
      getCandles: vi.fn(async () => ({
        candles: [candle("2026-06-22T00:00:00+09:00")],
        nextBefore: null,
      })),
    } as unknown as ServerTossClient;

    const summary = await runAdvisorJobsOnce({ client, provider: stubProvider() });

    expect(summary.processed).toBe(1);
    expect(summary.analyzed).toBe(1);
    expect(summary.results[0]).toMatchObject({ symbol: "SOXL", ok: true, decision: "sell" });
    expect(recordMarketAdvice).toHaveBeenCalledTimes(1);
  });

  it("skips items that are not due yet", async () => {
    recordMarketAdvice.mockClear();
    listEnabledWatchlist.mockReturnValue([
      { ...item("SOXL", 1), runEveryMinutes: 60, lastRunAt: new Date().toISOString() },
    ]);
    const client = {
      getCandles: vi.fn(),
    } as unknown as ServerTossClient;

    const summary = await runAdvisorJobsOnce({ client, provider: stubProvider() });

    expect(summary.processed).toBe(1);
    expect(summary.analyzed).toBe(0);
    expect(recordMarketAdvice).not.toHaveBeenCalled();
  });

  it("skips the LLM call when no new candle since the last analysis", async () => {
    recordMarketAdvice.mockClear();
    listEnabledWatchlist.mockReturnValue([
      { ...item("SOXL", 1), lastChartTimestamp: "2026-06-22T00:00:00+09:00" },
    ]);
    const client = {
      getCandles: vi.fn(async () => ({
        candles: [candle("2026-06-22T00:00:00+09:00")],
        nextBefore: null,
      })),
    } as unknown as ServerTossClient;

    const summary = await runAdvisorJobsOnce({ client, provider: stubProvider() });

    expect(summary.analyzed).toBe(0);
    expect(summary.results[0]).toMatchObject({ symbol: "SOXL", skipped: true });
    expect(recordMarketAdvice).not.toHaveBeenCalled();
  });

  it("fetches daily candles and injects a higher-timeframe trend for a minute item", async () => {
    recordMarketAdvice.mockClear();
    listEnabledWatchlist.mockReturnValue([{ ...item("SOXL", 1), interval: "1m" }]);
    const client = {
      getCandles: vi.fn(async ({ interval }: { interval: string }) =>
        interval === "1m"
          ? { candles: [candle("2026-06-22T10:00:00+09:00")], nextBefore: null }
          : {
              candles: [
                candle("2026-06-20T00:00:00+09:00"),
                candle("2026-06-21T00:00:00+09:00"),
              ],
              nextBefore: null,
            },
      ),
    } as unknown as ServerTossClient;
    const { provider, calls } = capturingProvider();

    await runAdvisorJobsOnce({ client, provider });

    // The worker fetched the daily series in addition to the minute chart.
    expect(client.getCandles).toHaveBeenCalledWith({ symbol: "SOXL", interval: "1d" });
    expect(userContent(calls[0])).toContain("상위 추세(1d 기준):");
  });

  it("skips the higher-timeframe fetch for a daily item", async () => {
    recordMarketAdvice.mockClear();
    listEnabledWatchlist.mockReturnValue([item("SOXL", 1)]); // interval "1d"
    const client = {
      getCandles: vi.fn(async () => ({
        candles: [candle("2026-06-22T00:00:00+09:00")],
        nextBefore: null,
      })),
    } as unknown as ServerTossClient;
    const { provider, calls } = capturingProvider();

    await runAdvisorJobsOnce({ client, provider });

    // Only the chart fetch — no extra daily request, no higher-timeframe block.
    expect(client.getCandles).toHaveBeenCalledTimes(1);
    expect(userContent(calls[0])).not.toContain("상위 추세");
  });

  it("isolates a per-item failure so others still run", async () => {
    recordMarketAdvice.mockClear();
    listEnabledWatchlist.mockReturnValue([item("BAD", 1), item("GOOD", 2)]);
    const client = {
      getCandles: vi.fn(async ({ symbol }: { symbol: string }) => {
        if (symbol === "BAD") {
          throw new Error("fetch failed");
        }
        return { candles: [candle("2026-06-22T00:00:00+09:00")], nextBefore: null };
      }),
    } as unknown as ServerTossClient;

    const summary = await runAdvisorJobsOnce({ client, provider: stubProvider() });

    expect(summary.processed).toBe(2);
    expect(summary.results[0]).toMatchObject({ symbol: "BAD", ok: false });
    expect(summary.results[1]).toMatchObject({ symbol: "GOOD", ok: true });
    expect(recordMarketAdvice).toHaveBeenCalledTimes(1);
  });
});
