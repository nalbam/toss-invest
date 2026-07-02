import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketAdviceHistoryRecord } from "@/lib/server/market-advisor/history";

const { chat, recordMarketAdvice, readMarketAdviceHistory, LlmNotConfiguredError } =
  vi.hoisted(() => ({
    chat: vi.fn(),
    recordMarketAdvice: vi.fn(),
    readMarketAdviceHistory: vi.fn((): MarketAdviceHistoryRecord[] => []),
    LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
  }));

vi.mock("@/lib/server/llm/container", () => ({
  getServerLlmProvider: () => ({ chat }),
  LlmNotConfiguredError,
}));

vi.mock("@/lib/server/market-advisor/history", () => ({
  recordMarketAdvice,
  readMarketAdviceHistory,
}));

vi.mock("@/lib/server/news/container", () => ({
  getServerNewsSearch: () => null,
}));

// Plain function (not vi.fn) so the per-test `vi.clearAllMocks()` never wipes it
// and the route sees an authenticated session under `withAuth`.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "test" } }) } },
}));

import { POST } from "./route";

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/market-advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

describe("POST /api/market-advisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chat.mockResolvedValue({
      model: "test-model",
      content: JSON.stringify({
        advice: "관망",
        decision: {
          action: "wait",
          label: "관망",
          reason: "추세 확인",
        },
        annotations: {
          supportLevels: [],
          resistanceLevels: [],
          markers: [],
        },
      }),
    });
  });

  it("records advisor history at the newest candle timestamp regardless of input order", async () => {
    const res = await POST(
      postReq({
        symbol: "005930",
        name: "삼성전자",
        interval: "1m",
        currency: "KRW",
        lastPrice: "105",
        candles: [
          candle("2026-06-22T10:02:00+09:00"),
          candle("2026-06-22T10:01:00+09:00"),
          candle("2026-06-22T10:00:00+09:00"),
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(recordMarketAdvice).toHaveBeenCalledWith(
      expect.objectContaining({
        chartTimestamp: "2026-06-22T10:02:00+09:00",
      }),
    );
  });

  it("injects the analysis time and recent advice history server-side", async () => {
    readMarketAdviceHistory.mockReturnValueOnce([
      {
        symbol: "005930",
        interval: "1m",
        generatedAt: "2026-06-21T00:00:00.000Z",
        chartTimestamp: null,
        chartFrom: null,
        candleCount: null,
        lastPrice: "104",
        decision: { action: "buy", label: "지지 반등", reason: "r" },
        advice: "a",
        cachedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);

    const res = await POST(
      postReq({
        symbol: "005930",
        interval: "1m",
        currency: "KRW",
        lastPrice: "105",
        candles: [candle("2026-06-22T10:00:00+09:00")],
      }),
    );

    expect(res.status).toBe(200);
    expect(readMarketAdviceHistory).toHaveBeenCalledWith({
      symbol: "005930",
      interval: "1m",
      limit: 3,
    });
    const user = chat.mock.calls[0][0].messages.find(
      (message: { role: string }) => message.role === "user",
    );
    expect(user.content).toContain("분석 시각: ");
    expect(user.content).toContain("직전 조언(최신순):");
    expect(user.content).toContain('buy "지지 반등" (당시 가격 104)');
  });
});
