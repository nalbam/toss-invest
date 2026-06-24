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

  it("spells out concrete buy triggers in the system message", () => {
    const system = buildMarketAdvisorPrompt(request)[0].content;
    for (const trigger of ["눌림목", "과매도", "돌파", "박스권 하단"]) {
      expect(system).toContain(trigger);
    }
  });

  it("spells out concrete sell triggers in the system message", () => {
    const system = buildMarketAdvisorPrompt(request)[0].content;
    for (const trigger of ["과매수", "저항", "차익실현", "손절"]) {
      expect(system).toContain(trigger);
    }
  });

  it("describes both hold and wait decisions in the system message", () => {
    const system = buildMarketAdvisorPrompt(request)[0].content;
    expect(system).toContain("관망");
    expect(system).toContain("보유 유지");
  });

  it("handles a held position's profit and loss symmetrically", () => {
    const system = buildMarketAdvisorPrompt(request)[0].content;
    // Loss does not force a stop-loss; profit does not force a hold.
    expect(system).toContain("평가손실");
    expect(system).toContain("평가수익");
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

  it("includes position info in the user message when held", () => {
    const user = buildMarketAdvisorPrompt({
      ...request,
      position: { quantity: "10", averagePrice: "650" },
    })[1].content;
    expect(user).toContain("보유: 10주, 평단가: 650");
  });

  it("omits position info when not held", () => {
    const user = buildMarketAdvisorPrompt(request)[1].content;
    expect(user).not.toContain("보유:");
  });

  it("embeds a computed technical-indicator block when candles suffice", () => {
    // 15 increasing closes give MA5, RSI(14) and recent high/low.
    const candles = Array.from({ length: 15 }, (_, i) => {
      const close = 100 + i;
      return {
        timestamp: `2026-06-01T00:${String(i).padStart(2, "0")}:00+09:00`,
        openPrice: String(close),
        highPrice: String(close + 5),
        lowPrice: String(close - 5),
        closePrice: String(close),
        volume: "1000",
        currency: "KRW",
      };
    });
    const user = buildMarketAdvisorPrompt({ ...request, candles })[1].content;
    expect(user).toContain("기술지표(계산값):");
    expect(user).toContain("MA5=");
    expect(user).toContain("RSI(14):");
    expect(user).toContain("고가/저가:");
  });

  it("omits the indicator block entirely when no candles are given", () => {
    const user = buildMarketAdvisorPrompt({ ...request, candles: [] })[1].content;
    expect(user).not.toContain("기술지표(계산값):");
  });

  it("instructs multi-timeframe judgement in the system message", () => {
    const system = buildMarketAdvisorPrompt(request)[0].content;
    expect(system).toContain("상위 시간대");
  });

  it("embeds the higher-timeframe trend block when provided", () => {
    const user = buildMarketAdvisorPrompt({
      ...request,
      higherTimeframeTrend: {
        interval: "1d",
        direction: "up",
        lastPrice: 70000,
        movingAverages: [{ period: 20, value: 68000, position: "above" }],
        recentHigh: 72000,
        recentLow: 64000,
      },
    })[1].content;
    expect(user).toContain("상위 추세(1d 기준):");
    expect(user).toContain("방향=상승");
    expect(user).toContain("MA20=68000(위)");
  });

  it("omits the higher-timeframe block when not provided", () => {
    const user = buildMarketAdvisorPrompt(request)[1].content;
    expect(user).not.toContain("상위 추세");
  });
});
