import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";

// Global key/value store backing what used to live in the browser's
// localStorage (theme, collapsed cards, chart settings, selected account,
// advisor auto settings, ...). There is no per-user scoping —
// a single global row set, matching the favorites/watchlist single-user model.

export interface SettingEntry {
  key: string;
  value: string;
}

interface SettingRow {
  key: string;
  value: string;
}

export function getAllSettings(
  db: Database.Database = getDb(),
): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM app_settings").all();
  const settings: Record<string, string> = {};
  for (const row of rows as SettingRow[]) {
    settings[row.key] = row.value;
  }
  return settings;
}

export interface SettingsChanges {
  upserts?: SettingEntry[];
  deletes?: string[];
}

/** Upper bound on total stored keys, so the global KV can't grow without bound. */
export const MAX_TOTAL_KEYS = 1000;

/** Thrown when a batch would push the store past `MAX_TOTAL_KEYS`. */
export class SettingsLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsLimitError";
  }
}

/** Applies a batch of upserts and deletes in a single transaction. */
export function applySettings(
  changes: SettingsChanges,
  db: Database.Database = getDb(),
): void {
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare("DELETE FROM app_settings WHERE key = ?");
  const count = db.prepare("SELECT COUNT(*) AS n FROM app_settings");
  const run = db.transaction((next: SettingsChanges) => {
    const now = new Date().toISOString();
    for (const entry of next.upserts ?? []) {
      upsert.run(entry.key, entry.value, now);
    }
    for (const key of next.deletes ?? []) {
      remove.run(key);
    }
    // Enforced after applying the batch so deletes in the same request free room.
    // Throwing rolls the whole transaction back (better-sqlite3), so an
    // over-limit batch is rejected atomically.
    const total = (count.get() as { n: number }).n;
    if (total > MAX_TOTAL_KEYS) {
      throw new SettingsLimitError(
        `settings key limit exceeded (${total} > ${MAX_TOTAL_KEYS})`,
      );
    }
  });
  run(changes);
}
