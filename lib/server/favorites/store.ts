import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";

// User's favorite symbols, backed by SQLite (favorites). These are explicit user
// settings (starred from the quote header / search modal), so write failures
// surface to the caller rather than being swallowed like the advice log.

export interface Favorite {
  id: number;
  symbol: string;
  name: string | null;
  currency: string | null;
}

interface FavoriteRow {
  id: number;
  symbol: string;
  name: string | null;
  currency: string | null;
  created_at: string;
}

function rowToFavorite(row: FavoriteRow): Favorite {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
  };
}

export function listFavorites(db: Database.Database = getDb()): Favorite[] {
  const rows = db.prepare("SELECT * FROM favorites ORDER BY id ASC").all();
  return (rows as FavoriteRow[]).map(rowToFavorite);
}

export interface AddFavoriteInput {
  symbol: string;
  name?: string;
  currency?: string;
}

/** Adds a favorite; re-adding the same symbol refreshes its name/currency. */
export function addFavorite(
  input: AddFavoriteInput,
  db: Database.Database = getDb(),
): Favorite {
  const row = db
    .prepare(
      `INSERT INTO favorites (symbol, name, currency, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol)
         DO UPDATE SET name = excluded.name, currency = excluded.currency
       RETURNING *`,
    )
    .get(
      input.symbol,
      input.name ?? null,
      input.currency ?? null,
      new Date().toISOString(),
    );
  return rowToFavorite(row as FavoriteRow);
}

export function removeFavorite(
  symbol: string,
  db: Database.Database = getDb(),
): void {
  db.prepare("DELETE FROM favorites WHERE symbol = ?").run(symbol);
}
