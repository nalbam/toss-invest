import { describe, expect, it } from "vitest";
import {
  aggregateCandles,
  combineCandlePages,
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

describe("combineCandlePages", () => {
  it("merges into one ascending series de-duplicated by timestamp", () => {
    const older = [
      candle("2026-06-18T09:00:00Z"),
      candle("2026-06-18T09:01:00Z"),
    ];
    const latest = [
      candle("2026-06-18T09:01:00Z"), // overlaps older
      candle("2026-06-18T09:02:00Z"),
    ];
    const result = combineCandlePages(older, latest);
    expect(result.map((c) => c.timestamp)).toEqual([
      "2026-06-18T09:00:00Z",
      "2026-06-18T09:01:00Z",
      "2026-06-18T09:02:00Z",
    ]);
  });

  it("keeps the later list's copy on a timestamp conflict (freshest wins)", () => {
    const older = [candle("2026-06-18T09:01:00Z", { closePrice: "100" })];
    const latest = [candle("2026-06-18T09:01:00Z", { closePrice: "105" })];
    const result = combineCandlePages(older, latest);
    expect(result).toHaveLength(1);
    expect(result[0].closePrice).toBe("105");
  });

  it("orders by parsed instant across mixed timestamp formats", () => {
    const result = combineCandlePages([
      candle("2026-06-18T10:00:00Z"),
      candle("2026-06-18T18:00:00+09:00"), // == 09:00Z, earlier
    ]);
    expect(result[0].timestamp).toBe("2026-06-18T18:00:00+09:00");
  });
});
