import { describe, expect, it } from "vitest";
import { latestCandleTimestamp, timestampMs } from "./timestamp";

describe("timestampMs", () => {
  it("parses ISO timestamps", () => {
    expect(timestampMs("2026-06-22T10:00:00+09:00")).toBe(
      Date.parse("2026-06-22T10:00:00+09:00"),
    );
  });

  it("treats <13 digit numeric strings as epoch seconds", () => {
    expect(timestampMs("1000")).toBe(1_000_000);
  });

  it("treats >=13 digit numeric strings as epoch millis", () => {
    expect(timestampMs("1700000000000")).toBe(1_700_000_000_000);
  });

  it("returns null for unparseable input", () => {
    expect(timestampMs("not-a-date")).toBeNull();
  });
});

describe("latestCandleTimestamp", () => {
  const candle = (timestamp: string) => ({
    timestamp,
    openPrice: "1",
    highPrice: "1",
    lowPrice: "1",
    closePrice: "1",
    volume: "1",
    currency: "KRW",
  });

  it("returns the newest timestamp regardless of input order", () => {
    expect(
      latestCandleTimestamp({
        candles: [
          candle("2026-06-22T10:02:00+09:00"),
          candle("2026-06-22T10:01:00+09:00"),
          candle("2026-06-22T10:00:00+09:00"),
        ],
      }),
    ).toBe("2026-06-22T10:02:00+09:00");
  });

  it("returns null for an empty candle list", () => {
    expect(latestCandleTimestamp({ candles: [] })).toBeNull();
  });

  it("skips unparseable timestamps", () => {
    expect(
      latestCandleTimestamp({
        candles: [candle("bad"), candle("2026-06-22T10:00:00+09:00")],
      }),
    ).toBe("2026-06-22T10:00:00+09:00");
  });
});
