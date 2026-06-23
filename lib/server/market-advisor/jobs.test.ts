import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "@/lib/server/llm/types";
import type { ServerTossClient } from "@/lib/server/toss/container";

const { listEnabledWatchlist, touchWatchlistRun, recordMarketAdvice } = vi.hoisted(() => ({
  listEnabledWatchlist: vi.fn(),
  touchWatchlistRun: vi.fn(),
  recordMarketAdvice: vi.fn(),
}));

vi.mock("./watchlist", () => ({ listEnabledWatchlist, touchWatchlistRun }));
vi.mock("./history", () => ({ recordMarketAdvice }));

import { runAdvisorJobsOnce } from "./jobs";

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
