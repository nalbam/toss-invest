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
    const token = claimWatchlistRun(a.id, null, "2026-06-23T00:00:00.000Z", db);
    touchWatchlistRun(a.id, token!, "2026-06-23T00:00:00.000Z", "2026-06-22T15:00:00.000Z", db);
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
      expect(claimed).not.toBeNull();
      expect(listWatchlist(db)[0].lastRunAt).toBe("2026-06-23T00:00:00.000Z");
    });

    it("fails the claim when last_run_at no longer matches (a concurrent pass already claimed it)", () => {
      const db = makeDb();
      const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db);
      expect(claimWatchlistRun(a.id, null, "2026-06-23T00:00:00.000Z", db)).not.toBeNull();

      // A second pass reading the stale (pre-claim) `null` value must lose the race.
      const secondClaim = claimWatchlistRun(a.id, null, "2026-06-23T00:00:05.000Z", db);
      expect(secondClaim).toBeNull();
      expect(listWatchlist(db)[0].lastRunAt).toBe("2026-06-23T00:00:00.000Z");
    });
  });

  describe("touchWatchlistRun ownership", () => {
    it("completes the run and releases the claim when the token still owns the row", () => {
      const db = makeDb();
      const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db);
      const token = claimWatchlistRun(a.id, null, "2026-06-23T00:00:00.000Z", db);
      touchWatchlistRun(a.id, token!, "2026-06-23T00:00:00.000Z", "2026-06-22T15:00:00.000Z", db);
      const stored = listWatchlist(db)[0];
      expect(stored.lastRunAt).toBe("2026-06-23T00:00:00.000Z");
      expect(stored.lastChartTimestamp).toBe("2026-06-22T15:00:00.000Z");
    });

    it("silently skips the write when a later pass re-claimed the row first", () => {
      const db = makeDb();
      const a = addWatchlist({ symbol: "AAA", interval: "1d" }, db);
      // Pass A claims first.
      const tokenA = claimWatchlistRun(a.id, null, "2026-06-23T00:00:00.000Z", db);
      expect(tokenA).not.toBeNull();

      // Pass A's processing outlives run_every_minutes: by the time pass B's
      // tick fires, A still hasn't reached touchWatchlistRun, so B reads A's
      // claimed last_run_at as the current value and re-claims against it.
      const tokenB = claimWatchlistRun(
        a.id,
        "2026-06-23T00:00:00.000Z",
        "2026-06-23T00:05:00.000Z",
        db,
      );
      expect(tokenB).not.toBeNull();
      expect(tokenB).not.toBe(tokenA);

      // A finishes late and tries to complete with its now-stale token.
      touchWatchlistRun(a.id, tokenA!, "2026-06-23T00:00:00.000Z", "STALE", db);

      // B's claim must survive untouched — A's stale write is a no-op.
      const stored = listWatchlist(db)[0];
      expect(stored.lastRunAt).toBe("2026-06-23T00:05:00.000Z");
      expect(stored.lastChartTimestamp).toBeNull();
    });
  });
});
