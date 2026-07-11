import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "./sqlite";

describe("initSchema / migrate", () => {
  it("is idempotent — calling it twice does not throw", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
  });

  it("rebuilds an old-shape candle_coverage table, preserving its rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE candle_coverage (
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        covered_from_epoch INTEGER NOT NULL,
        covered_to_epoch INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (symbol, interval)
      );
    `);
    db.prepare(
      "INSERT INTO candle_coverage (symbol, interval, covered_from_epoch, covered_to_epoch, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("005930", "1d", 1000, 2000, "2026-01-01T00:00:00Z");

    initSchema(db);

    const pk = (db.prepare("PRAGMA table_info(candle_coverage)").all() as { name: string; pk: number }[]).filter(
      (c) => c.pk > 0,
    );
    expect(pk.map((c) => c.name).sort()).toEqual(["covered_from_epoch", "interval", "symbol"]);
    const rows = db.prepare("SELECT * FROM candle_coverage").all();
    expect(rows).toEqual([
      {
        symbol: "005930",
        interval: "1d",
        covered_from_epoch: 1000,
        covered_to_epoch: 2000,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("rolls back the whole migration atomically if one step fails", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE advisor_watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        name TEXT,
        interval TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'KRW',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(symbol, interval)
      );
    `);
    const realExec = db.exec.bind(db);
    const execSpy = vi.spyOn(db, "exec").mockImplementation((sql: string) => {
      if (sql.includes("last_chart_timestamp")) {
        throw new Error("simulated failure mid-migration");
      }
      return realExec(sql);
    });

    expect(() => initSchema(db)).toThrow(/simulated failure/);
    execSpy.mockRestore();

    // The earlier ALTER (run_every_minutes) in the same transaction must have
    // been rolled back too — otherwise the schema is left half-migrated.
    const columns = (db.prepare("PRAGMA table_info(advisor_watchlist)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).not.toContain("run_every_minutes");
    expect(columns).not.toContain("last_run_at");
  });
});
