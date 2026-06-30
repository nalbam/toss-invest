import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";

// Global key/value store backing what used to live in the browser's
// localStorage (theme, collapsed cards, chart settings, selected account,
// per-symbol order drafts, advisor caches, ...). There is no per-user scoping —
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
  const run = db.transaction((next: SettingsChanges) => {
    const now = new Date().toISOString();
    for (const entry of next.upserts ?? []) {
      upsert.run(entry.key, entry.value, now);
    }
    for (const key of next.deletes ?? []) {
      remove.run(key);
    }
  });
  run(changes);
}
