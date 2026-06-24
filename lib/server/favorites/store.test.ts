import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import { addFavorite, listFavorites, removeFavorite } from "./store";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("favorites store", () => {
  it("adds and lists favorites in insertion order", () => {
    const db = makeDb();
    addFavorite({ symbol: "005930", name: "삼성전자", currency: "KRW" }, db);
    addFavorite({ symbol: "AAPL", name: "Apple", currency: "USD" }, db);
    const items = listFavorites(db);
    expect(items.map((f) => f.symbol)).toEqual(["005930", "AAPL"]);
    expect(items[0]).toMatchObject({
      symbol: "005930",
      name: "삼성전자",
      currency: "KRW",
    });
  });

  it("upserts the same symbol (refreshes name, no duplicate)", () => {
    const db = makeDb();
    addFavorite({ symbol: "AAPL", name: "Apple" }, db);
    addFavorite({ symbol: "AAPL", name: "Apple Inc." }, db);
    const items = listFavorites(db);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Apple Inc.");
  });

  it("removes by symbol", () => {
    const db = makeDb();
    addFavorite({ symbol: "AAPL" }, db);
    addFavorite({ symbol: "005930" }, db);
    removeFavorite("AAPL", db);
    expect(listFavorites(db).map((f) => f.symbol)).toEqual(["005930"]);
  });
});
