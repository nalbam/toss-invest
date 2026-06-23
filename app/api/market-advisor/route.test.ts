import { beforeEach, describe, expect, it, vi } from "vitest";

const { chat, recordMarketAdvice, LlmNotConfiguredError } = vi.hoisted(() => ({
  chat: vi.fn(),
  recordMarketAdvice: vi.fn(),
  LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
}));

vi.mock("@/lib/server/llm/container", () => ({
  getServerLlmProvider: () => ({ chat }),
  LlmNotConfiguredError,
}));

vi.mock("@/lib/server/cache/market-history", () => ({
  recordMarketAdvice,
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
});
