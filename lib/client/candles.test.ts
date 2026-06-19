import { describe, expect, it } from "vitest";
import {
  aggregateCandles,
  sourceInterval,
  type ChartInterval,
} from "@/lib/client/candles";
import type { Candle } from "@/lib/client/types";

function candle(timestamp: string, overrides: Partial<Candle> = {}): Candle {
  return {
    timestamp,
    openPrice: "100",
    highPrice: "110",
    lowPrice: "90",
    closePrice: "105",
    volume: "10",
    currency: "KRW",
    ...overrides,
  };
}

describe("sourceInterval", () => {
  it("uses only Toss-supported source intervals", () => {
    const minuteIntervals: ChartInterval[] = [
      "1m",
    ];
    for (const interval of minuteIntervals) {
      expect(sourceInterval(interval)).toBe("1m");
    }
    expect(sourceInterval("1d")).toBe("1d");
    expect(sourceInterval("1w")).toBe("1d");
    expect(sourceInterval("1mo")).toBe("1d");
    expect(sourceInterval("1y")).toBe("1d");
  });
});

describe("aggregateCandles", () => {
  it("returns source candles unchanged for native intervals", () => {
    const candles = [candle("2026-06-19T09:00:00+09:00")];
    expect(aggregateCandles(candles, "1m")).toBe(candles);
    expect(aggregateCandles(candles, "1d")).toBe(candles);
  });

  it("aggregates daily candles into weekly buckets", () => {
    const result = aggregateCandles(
      [
        candle("2026-06-15T00:00:00+09:00", {
          openPrice: "100",
          highPrice: "120",
          lowPrice: "95",
          closePrice: "110",
        }),
        candle("2026-06-19T00:00:00+09:00", {
          openPrice: "110",
          highPrice: "125",
          lowPrice: "90",
          closePrice: "115",
        }),
      ],
      "1w",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      openPrice: "100",
      highPrice: "125",
      lowPrice: "90",
      closePrice: "115",
    });
  });
});
