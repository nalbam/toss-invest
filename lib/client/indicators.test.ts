import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/client/types";
import { computeIndicators, summarizeTrend } from "./indicators";

function candle(
  close: number,
  high: number,
  low: number,
  volume: number,
  index: number,
): Candle {
  return {
    timestamp: `2026-06-01T00:${String(index).padStart(2, "0")}:00+09:00`,
    openPrice: String(close),
    highPrice: String(high),
    lowPrice: String(low),
    closePrice: String(close),
    volume: String(volume),
    currency: "KRW",
  };
}

// Increasing-by-1 series (close 100..114) with ±5 high/low bands and a volume
// step-up over the last 5 bars. Every indicator below is hand-computable.
const rising: Candle[] = Array.from({ length: 15 }, (_, i) => {
  const close = 100 + i;
  const volume = i < 10 ? 1000 : 2000;
  return candle(close, close + 5, close - 5, volume, i);
});

describe("computeIndicators", () => {
  it("computes MA5 and current-price position for a sufficient series", () => {
    const ind = computeIndicators(rising);
    const ma5 = ind.movingAverages.find((m) => m.period === 5);
    expect(ma5?.value).toBe(112); // mean of closes 110..114
    expect(ma5?.position).toBe("above"); // last close 114 > 112
  });

  it("omits MA20 and MA60 when the series is too short", () => {
    const ind = computeIndicators(rising);
    expect(ind.movingAverages.find((m) => m.period === 20)).toBeUndefined();
    expect(ind.movingAverages.find((m) => m.period === 60)).toBeUndefined();
  });

  it("returns RSI 100 when every recent change is a gain", () => {
    expect(computeIndicators(rising).rsi14).toBe(100);
  });

  it("computes RSI(14) from the last 14 price changes", () => {
    // 14 deltas: seven +2 and seven -1 → avgGain 1, avgLoss 0.5, RS 2, RSI 66.7.
    const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
    const series = closes.map((c, i) => candle(c, c + 1, c - 1, 1000, i));
    expect(computeIndicators(series).rsi14).toBe(66.7);
  });

  it("reports recent high/low as support/resistance candidates", () => {
    const ind = computeIndicators(rising);
    expect(ind.recentHigh).toBe(119); // high of close 114
    expect(ind.recentLow).toBe(95); // low of close 100
  });

  it("reports a rising volume trend when recent volume exceeds the average", () => {
    const ind = computeIndicators(rising);
    expect(ind.volume?.recentAverage).toBe(2000);
    expect(ind.volume?.ratio).toBe(1.5); // 2000 / 1333.33
    expect(ind.volume?.trend).toBe("rising");
  });

  it("approximates volatility with ATR(14)", () => {
    expect(computeIndicators(rising).volatility?.atr14).toBe(10);
  });

  it("omits length-gated indicators for a single candle", () => {
    const ind = computeIndicators([candle(100, 110, 95, 1000, 0)]);
    expect(ind.movingAverages).toEqual([]);
    expect(ind.rsi14).toBeUndefined();
    expect(ind.volume).toBeUndefined();
    expect(ind.volatility?.atr14).toBeUndefined();
    // Recent high/low fall back to the only candle available.
    expect(ind.recentHigh).toBe(110);
    expect(ind.recentLow).toBe(95);
  });

  it("returns empty indicators for no candles", () => {
    const ind = computeIndicators([]);
    expect(ind.movingAverages).toEqual([]);
    expect(ind.rsi14).toBeUndefined();
    expect(ind.recentHigh).toBeUndefined();
  });
});

describe("summarizeTrend", () => {
  it("summarizes an up trend with the given interval label", () => {
    const summary = summarizeTrend(rising, "1d");
    expect(summary?.interval).toBe("1d");
    expect(summary?.direction).toBe("up"); // close above the only available MA
    expect(summary?.recentHigh).toBe(119);
    expect(summary?.recentLow).toBe(95);
  });

  it("reports a down trend when the short MA sits below the long MA", () => {
    // 25 decreasing closes (124..100): MA5 < MA20 and last close below MA20.
    const falling = Array.from({ length: 25 }, (_, i) => {
      const close = 124 - i;
      return candle(close, close + 2, close - 2, 1000, i);
    });
    expect(summarizeTrend(falling, "1d")?.direction).toBe("down");
  });

  it("returns null when there are no candles", () => {
    expect(summarizeTrend([], "1d")).toBeNull();
  });
});
