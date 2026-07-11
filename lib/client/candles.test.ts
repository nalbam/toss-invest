import { describe, expect, it } from "vitest";
import {
  ADVISOR_TARGET_BARS,
  advisorSourceCandleCount,
  aggregateCandles,
  aggregateForAdvisor,
  CHART_INTERVALS,
  combineCandlePages,
  DAY_CHART_INTERVALS,
  isMinuteInterval,
  MINUTE_CHART_INTERVALS,
  sourceBarsPerChartBar,
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
      "3m",
      "5m",
      "10m",
      "30m",
      "60m",
      "120m",
      "240m",
    ];
    for (const interval of minuteIntervals) {
      expect(sourceInterval(interval)).toBe("1m");
      expect(isMinuteInterval(interval)).toBe(true);
    }
    for (const interval of ["1d", "1w", "1mo", "1y"] as ChartInterval[]) {
      expect(sourceInterval(interval)).toBe("1d");
      expect(isMinuteInterval(interval)).toBe(false);
    }
  });

  it("exposes minute granularities and day intervals separately, unioned in CHART_INTERVALS", () => {
    expect(MINUTE_CHART_INTERVALS.map((i) => i.value)).toEqual([
      "1m",
      "3m",
      "5m",
      "10m",
      "30m",
      "60m",
      "120m",
      "240m",
    ]);
    expect(DAY_CHART_INTERVALS.map((i) => i.value)).toEqual([
      "1d",
      "1w",
      "1mo",
      "1y",
    ]);
    expect(CHART_INTERVALS).toHaveLength(
      MINUTE_CHART_INTERVALS.length + DAY_CHART_INTERVALS.length,
    );
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

  it("aggregates 1m candles into clock-aligned 5m buckets", () => {
    // 09:00–09:04 → one 5m bucket; 09:05 → the next.
    const result = aggregateCandles(
      [
        candle("2026-06-19T09:00:00Z", { openPrice: "100", highPrice: "104", lowPrice: "99", closePrice: "101", volume: "10" }),
        candle("2026-06-19T09:01:00Z", { openPrice: "101", highPrice: "106", lowPrice: "100", closePrice: "105", volume: "20" }),
        candle("2026-06-19T09:04:00Z", { openPrice: "105", highPrice: "108", lowPrice: "97", closePrice: "103", volume: "30" }),
        candle("2026-06-19T09:05:00Z", { openPrice: "103", highPrice: "109", lowPrice: "102", closePrice: "107", volume: "40" }),
      ],
      "5m",
    );

    expect(result).toHaveLength(2);
    // First bucket [09:00, 09:05): open of first, close of last, high/low/volume merged.
    expect(result[0]).toMatchObject({
      openPrice: "100",
      highPrice: "108",
      lowPrice: "97",
      closePrice: "103",
      volume: "60",
    });
    // Second bucket starts exactly on the 09:05 clock boundary.
    expect(result[1].timestamp).toBe("2026-06-19T09:05:00.000Z");
    expect(result[1]).toMatchObject({ openPrice: "103", closePrice: "107" });
  });

  it("does not let an unparseable high/low poison the whole bucket's merge", () => {
    // The first bar's high/low fail to parse; a naive Number(a) > Number(b)
    // reduce would seed the accumulator with NaN and never recover, since any
    // comparison against NaN is false — the bucket would keep the bad value
    // instead of the later bars' real high/low.
    const result = aggregateCandles(
      [
        candle("2026-06-19T09:00:00Z", { highPrice: "n/a", lowPrice: "n/a" }),
        candle("2026-06-19T09:01:00Z", { highPrice: "108", lowPrice: "97" }),
        candle("2026-06-19T09:02:00Z", { highPrice: "104", lowPrice: "99" }),
      ],
      "5m",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ highPrice: "108", lowPrice: "97" });
  });
});

describe("advisor candle window", () => {
  it("scales source-bar counts to the interval, capped for large intervals", () => {
    expect(sourceBarsPerChartBar("1m")).toBe(1);
    expect(sourceBarsPerChartBar("10m")).toBe(10);
    expect(sourceBarsPerChartBar("1w")).toBe(7);

    // 1m–10m stay under the cap → a full 200-bar window.
    expect(advisorSourceCandleCount("1m")).toBe(ADVISOR_TARGET_BARS);
    expect(advisorSourceCandleCount("10m")).toBe(ADVISOR_TARGET_BARS * 10);
    // Cap is 24×200 = 4800, so 30m+ get fewer than 200 aggregated bars:
    // 30m → 160, 60m → 80, 120m → 40, 240m → 20.
    expect(advisorSourceCandleCount("30m")).toBe(4800); // 4800/30 = 160 bars
    expect(advisorSourceCandleCount("60m")).toBe(4800); // 4800/60 = 80 bars
    expect(advisorSourceCandleCount("240m")).toBe(4800); // 4800/240 = 20 bars
  });

  it("aggregates a source window and keeps at most ADVISOR_TARGET_BARS bars", () => {
    // 600 one-minute candles → 120 five-minute bars (under the cap, kept whole).
    const source = Array.from({ length: 600 }, (_, i) =>
      candle(new Date(Date.parse("2026-06-19T00:00:00Z") + i * 60_000).toISOString()),
    );
    const bars = aggregateForAdvisor(source, "5m");
    expect(bars).toHaveLength(120);

    // 1m: 1:1, sliced to the most recent ADVISOR_TARGET_BARS.
    const minutes = Array.from({ length: ADVISOR_TARGET_BARS + 50 }, (_, i) =>
      candle(new Date(Date.parse("2026-06-19T00:00:00Z") + i * 60_000).toISOString()),
    );
    expect(aggregateForAdvisor(minutes, "1m")).toHaveLength(ADVISOR_TARGET_BARS);
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
