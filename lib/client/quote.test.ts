import { describe, expect, it } from "vitest";
import { previousClose, priceChange } from "./quote";
import type { Candle } from "./types";

function candle(timestamp: string, closePrice: string): Candle {
  return {
    timestamp,
    openPrice: "0",
    highPrice: "0",
    lowPrice: "0",
    closePrice,
    volume: "0",
    currency: "KRW",
  };
}

describe("previousClose", () => {
  it("returns the close of the bar before the latest", () => {
    const candles = [
      candle("2026-06-17T00:00:00+09:00", "100"),
      candle("2026-06-18T00:00:00+09:00", "110"),
      candle("2026-06-19T00:00:00+09:00", "120"),
    ];
    expect(previousClose(candles)).toBe("110");
  });

  it("ignores input order (sorts by timestamp)", () => {
    const candles = [
      candle("2026-06-19T00:00:00+09:00", "120"),
      candle("2026-06-17T00:00:00+09:00", "100"),
      candle("2026-06-18T00:00:00+09:00", "110"),
    ];
    expect(previousClose(candles)).toBe("110");
  });

  it("returns undefined with fewer than two candles", () => {
    expect(previousClose([])).toBeUndefined();
    expect(
      previousClose([candle("2026-06-19T00:00:00+09:00", "120")]),
    ).toBeUndefined();
  });
});

describe("priceChange", () => {
  it("computes a precise positive change amount and a ratio", () => {
    const c = priceChange("281.03", "279.29");
    expect(c?.amount).toBe("1.74");
    expect(c?.rate.startsWith("0.006")).toBe(true); // ~+0.62%
  });

  it("computes a negative change", () => {
    expect(priceChange("279.29", "281.03")?.amount).toBe("-1.74");
  });

  it("keeps KRW integer changes exact", () => {
    expect(priceChange("72000", "70000")?.amount).toBe("2000");
  });

  it("returns null for missing / zero / invalid inputs", () => {
    expect(priceChange(undefined, "100")).toBeNull();
    expect(priceChange("100", undefined)).toBeNull();
    expect(priceChange("100", "0")).toBeNull();
    expect(priceChange("abc", "100")).toBeNull();
  });
});
