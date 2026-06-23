import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import {
  addWatchlist,
  listEnabledWatchlist,
  listWatchlist,
  removeWatchlist,
  setWatchlistEnabled,
  touchWatchlistRun,
} from "./watchlist";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("advisor watchlist", () => {
  it("adds and lists items (enabled by default, 60m period)", () => {
    const db = makeDb();
    const item = addWatchlist({ symbol: "SOXL", interval: "1m" }, db);
    expect(item.symbol).toBe("SOXL");
    expect(item.enabled).toBe(true);
    expect(item.currency).toBe("KRW");
    expect(item.runEveryMinutes).toBe(60);
    expect(item.lastRunAt).toBeNull();
    expect(listWatchlist(db)).toHaveLength(1);
  });

  it("stores a custom run period and records last run time", () => {
    const db = makeDb();
    const a = addWatchlist({ symbol: "AAA", interval: "1d", runEveryMinutes: 1440 }, db);
    expect(a.runEveryMinutes).toBe(1440);
    touchWatchlistRun(a.id, "2026-06-23T00:00:00.000Z", db);
    expect(listWatchlist(db)[0].lastRunAt).toBe("2026-06-23T00:00:00.000Z");
  });

  it("upserts on duplicate (symbol, interval) and re-enables", () => {
    const db = makeDb();
    const a = addWatchlist({ symbol: "SOXL", interval: "1m", name: "old" }, db);
    setWatchlistEnabled(a.id, false, db);
    const b = addWatchlist({ symbol: "SOXL", interval: "1m", name: "new" }, db);
    expect(listWatchlist(db)).toHaveLength(1);
    expect(b.name).toBe("new");
    expect(b.enabled).toBe(true);
  });

  it("treats a different interval as a separate item", () => {
    const db = makeDb();
    addWatchlist({ symbol: "SOXL", interval: "1m" }, db);
    addWatchlist({ symbol: "SOXL", interval: "1d" }, db);
    expect(listWatchlist(db)).toHaveLength(2);
  });

  it("filters enabled items only", () => {
    const db = makeDb();
    const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db);
    addWatchlist({ symbol: "BBB", interval: "1d" }, db);
    setWatchlistEnabled(a.id, false, db);
    const enabled = listEnabledWatchlist(db);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].symbol).toBe("BBB");
  });

  it("removes an item", () => {
    const db = makeDb();
    const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db);
    removeWatchlist(a.id, db);
    expect(listWatchlist(db)).toHaveLength(0);
  });
});
