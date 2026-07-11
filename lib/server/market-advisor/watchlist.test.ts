import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import {
  addWatchlist,
  claimWatchlistRun,
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

  it("stores a custom run period and records last run + chart timestamp", () => {
    const db = makeDb();
    const a = addWatchlist({ symbol: "AAA", interval: "1d", runEveryMinutes: 1440 }, db);
    expect(a.runEveryMinutes).toBe(1440);
    expect(a.lastChartTimestamp).toBeNull();
    touchWatchlistRun(a.id, "2026-06-23T00:00:00.000Z", "2026-06-22T15:00:00.000Z", db);
    const stored = listWatchlist(db)[0];
    expect(stored.lastRunAt).toBe("2026-06-23T00:00:00.000Z");
    expect(stored.lastChartTimestamp).toBe("2026-06-22T15:00:00.000Z");
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

  describe("claimWatchlistRun", () => {
    it("claims the item and advances last_run_at when it matches the expected value", () => {
      const db = makeDb();
      const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db); // lastRunAt: null
      const claimed = claimWatchlistRun(a.id, null, "2026-06-23T00:00:00.000Z", db);
      expect(claimed).toBe(true);
      expect(listWatchlist(db)[0].lastRunAt).toBe("2026-06-23T00:00:00.000Z");
    });

    it("fails the claim when last_run_at no longer matches (a concurrent pass already claimed it)", () => {
      const db = makeDb();
      const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db);
      expect(claimWatchlistRun(a.id, null, "2026-06-23T00:00:00.000Z", db)).toBe(true);

      // A second pass reading the stale (pre-claim) `null` value must lose the race.
      const secondClaim = claimWatchlistRun(a.id, null, "2026-06-23T00:00:05.000Z", db);
      expect(secondClaim).toBe(false);
      expect(listWatchlist(db)[0].lastRunAt).toBe("2026-06-23T00:00:00.000Z");
    });
  });
});
