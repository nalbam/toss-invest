import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import { searchStockDirectory, upsertStockDirectory } from "./directory";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("stock directory", () => {
  it("upserts and searches by name substring", () => {
    const db = makeDb();
    upsertStockDirectory(
      [
        { symbol: "000660", name: "SK하이닉스", market: "KOSPI", currency: "KRW" },
        { symbol: "005930", name: "삼성전자", currency: "KRW" },
      ],
      db,
    );
    const hits = searchStockDirectory("하이닉스", 20, db);
    expect(hits.map((s) => s.symbol)).toEqual(["000660"]);
    expect(hits[0]).toMatchObject({ name: "SK하이닉스", currency: "KRW" });
  });

  it("matches by symbol, case-insensitively", () => {
    const db = makeDb();
    upsertStockDirectory([{ symbol: "AAPL", name: "Apple", currency: "USD" }], db);
    expect(searchStockDirectory("aapl", 20, db).map((s) => s.symbol)).toEqual([
      "AAPL",
    ]);
  });

  it("upserts without duplicating and refreshes the name", () => {
    const db = makeDb();
    upsertStockDirectory([{ symbol: "AAPL", name: "Apple" }], db);
    upsertStockDirectory([{ symbol: "AAPL", name: "Apple Inc." }], db);
    const hits = searchStockDirectory("AAPL", 20, db);
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Apple Inc.");
  });

  it("returns [] for a blank query", () => {
    const db = makeDb();
    upsertStockDirectory([{ symbol: "AAPL", name: "Apple" }], db);
    expect(searchStockDirectory("  ", 20, db)).toEqual([]);
  });

  it("respects the limit", () => {
    const db = makeDb();
    upsertStockDirectory(
      [
        { symbol: "A1", name: "Test One" },
        { symbol: "A2", name: "Test Two" },
        { symbol: "A3", name: "Test Three" },
      ],
      db,
    );
    expect(searchStockDirectory("Test", 2, db)).toHaveLength(2);
  });
});
