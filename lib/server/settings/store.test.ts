import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import {
  applySettings,
  getAllSettings,
  MAX_TOTAL_KEYS,
  SettingsLimitError,
} from "./store";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("settings store", () => {
  it("applies upserts and deletes in one batch", () => {
    const db = makeDb();
    applySettings(
      { upserts: [{ key: "a", value: "1" }, { key: "b", value: "2" }] },
      db,
    );
    applySettings({ upserts: [{ key: "a", value: "9" }], deletes: ["b"] }, db);
    expect(getAllSettings(db)).toEqual({ a: "9" });
  });

  it("rejects a batch that would exceed MAX_TOTAL_KEYS and rolls it back", () => {
    const db = makeDb();
    const upserts = Array.from({ length: MAX_TOTAL_KEYS + 1 }, (_, i) => ({
      key: `k${i}`,
      value: "x",
    }));

    expect(() => applySettings({ upserts }, db)).toThrow(SettingsLimitError);
    // The whole transaction rolled back — nothing was written.
    expect(Object.keys(getAllSettings(db))).toHaveLength(0);
  });

  it("lets deletes in the same batch free room under the cap", () => {
    const db = makeDb();
    const seed = Array.from({ length: MAX_TOTAL_KEYS }, (_, i) => ({
      key: `k${i}`,
      value: "x",
    }));
    applySettings({ upserts: seed }, db);

    // At the cap: adding one while deleting one stays within the limit.
    applySettings(
      { upserts: [{ key: "new", value: "x" }], deletes: ["k0"] },
      db,
    );
    expect(Object.keys(getAllSettings(db))).toHaveLength(MAX_TOTAL_KEYS);
  });
});
