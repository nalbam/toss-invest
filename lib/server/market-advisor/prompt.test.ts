import { describe, expect, it } from "vitest";
import { buildMarketAdvisorPrompt } from "./prompt";
import type { MarketAdvisorRequest } from "./schema";

const request: MarketAdvisorRequest = {
  symbol: "005930",
  name: "삼성전자",
  interval: "1m",
  currency: "KRW",
  lastPrice: "105",
  candles: [
    {
      timestamp: "2026-06-22T10:00:00+09:00",
      openPrice: "100",
      highPrice: "110",
      lowPrice: "95",
      closePrice: "105",
      volume: "1000",
      currency: "KRW",
    },
  ],
};

describe("buildMarketAdvisorPrompt", () => {
  it("returns a system message followed by a user message", () => {
    const messages = buildMarketAdvisorPrompt(request);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("states the analyze-only guardrail in the system message", () => {
    const system = buildMarketAdvisorPrompt(request)[0].content;
    expect(system).toMatch(/주문 실행이나 확정 표현은 하지/);
  });

  it("embeds the symbol title, interval and candle data in the user message", () => {
    const user = buildMarketAdvisorPrompt(request)[1].content;
    expect(user).toContain("삼성전자 (005930)");
    expect(user).toContain("1m");
    expect(user).toContain('"closePrice": "105"');
  });

  it("falls back to the bare symbol when no name is given", () => {
    const user = buildMarketAdvisorPrompt({ ...request, name: undefined })[1].content;
    expect(user).toContain("종목: 005930");
  });

  it("is deterministic for the same request", () => {
    expect(buildMarketAdvisorPrompt(request)).toEqual(buildMarketAdvisorPrompt(request));
  });
});
