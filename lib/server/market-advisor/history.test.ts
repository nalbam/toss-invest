import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import { recordMarketAdvice, readMarketAdviceHistory } from "./history";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

const base = {
  symbol: "005930",
  interval: "1d",
  generatedAt: "2026-06-23T00:00:00.000Z",
  chartTimestamp: "2026-06-22T00:00:00+09:00" as string | null,
  lastPrice: "72000" as string | undefined,
  decision: { action: "buy" as const, label: "매수 검토", reason: "지지선" },
  advice: "추세 개선",
};

describe("market advice history", () => {
  it("records and reads back newest-first", () => {
    const db = makeDb();
    recordMarketAdvice({ ...base, advice: "first" }, db);
    recordMarketAdvice({ ...base, advice: "second" }, db);
    const rows = readMarketAdviceHistory({ symbol: "005930", limit: 10 }, db);
    expect(rows).toHaveLength(2);
    expect(rows[0].advice).toBe("second");
    expect(rows[0].decision.action).toBe("buy");
    expect(typeof rows[0].cachedAt).toBe("string");
  });

  it("filters by interval", () => {
    const db = makeDb();
    recordMarketAdvice({ ...base, interval: "1d", advice: "daily" }, db);
    recordMarketAdvice({ ...base, interval: "1m", advice: "minute" }, db);
    const daily = readMarketAdviceHistory(
      { symbol: "005930", interval: "1d", limit: 10 },
      db,
    );
    expect(daily).toHaveLength(1);
    expect(daily[0].advice).toBe("daily");
  });

  it("honors the limit", () => {
    const db = makeDb();
    for (let i = 0; i < 5; i += 1) {
      recordMarketAdvice({ ...base, advice: `a${i}` }, db);
    }
    expect(readMarketAdviceHistory({ symbol: "005930", limit: 2 }, db)).toHaveLength(2);
  });

  it("preserves null chartTimestamp and absent lastPrice", () => {
    const db = makeDb();
    recordMarketAdvice({ ...base, chartTimestamp: null, lastPrice: undefined }, db);
    const rows = readMarketAdviceHistory({ symbol: "005930", limit: 10 }, db);
    expect(rows[0].chartTimestamp).toBeNull();
    expect(rows[0].lastPrice).toBeUndefined();
  });

  it("round-trips the analyzed-window fields (candleCount, chartFrom)", () => {
    const db = makeDb();
    recordMarketAdvice(
      { ...base, candleCount: 200, chartFrom: "2026-06-01T00:00:00+09:00" },
      db,
    );
    const rows = readMarketAdviceHistory({ symbol: "005930", limit: 10 }, db);
    expect(rows[0].candleCount).toBe(200);
    expect(rows[0].chartFrom).toBe("2026-06-01T00:00:00+09:00");
  });

  it("stores null analyzed-window fields when absent", () => {
    const db = makeDb();
    recordMarketAdvice({ ...base }, db);
    const rows = readMarketAdviceHistory({ symbol: "005930", limit: 10 }, db);
    expect(rows[0].candleCount).toBeNull();
    expect(rows[0].chartFrom).toBeNull();
  });

  it("round-trips annotations and returns undefined when absent", () => {
    const db = makeDb();
    const annotations = {
      supportLevels: [{ price: 68000, label: "지지" }],
      resistanceLevels: [{ price: 72000, label: "저항" }],
      markers: [{ timestamp: "2026-06-23T00:00:00.000Z", position: "aboveBar" as const, label: "돌파" }],
    };
    recordMarketAdvice({ ...base, advice: "with", annotations }, db);
    recordMarketAdvice({ ...base, advice: "without" }, db);
    const rows = readMarketAdviceHistory({ symbol: "005930", limit: 10 }, db);
    expect(rows[0].annotations).toBeUndefined();
    expect(rows[1].annotations).toEqual(annotations);
  });
});
