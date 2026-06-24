import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";

// Local code<->name directory enabling name search (the Toss API only looks up
// by exact code). Populated from TRUSTED sources only — Toss code lookups,
// holdings, favorites, or a bulk import of an exchange listing — never from
// hand-authored codes (a wrong code maps to the wrong stock).

export interface DirectoryStock {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
}

interface DirectoryRow {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
}

export interface UpsertStock {
  symbol: string;
  name: string;
  market?: string | null;
  currency?: string | null;
}

/** Inserts/updates directory entries. Best-effort callers should wrap in try/catch. */
export function upsertStockDirectory(
  stocks: UpsertStock[],
  db: Database.Database = getDb(),
): void {
  if (stocks.length === 0) {
    return;
  }
  const stmt = db.prepare(
    `INSERT INTO stock_directory (symbol, name, market, currency, updated_at)
     VALUES (@symbol, @name, @market, @currency, @updatedAt)
     ON CONFLICT(symbol)
       DO UPDATE SET name = excluded.name, market = excluded.market,
         currency = excluded.currency, updated_at = excluded.updated_at`,
  );
  const updatedAt = new Date().toISOString();
  const insertMany = db.transaction((rows: UpsertStock[]) => {
    for (const row of rows) {
      stmt.run({
        symbol: row.symbol,
        name: row.name,
        market: row.market ?? null,
        currency: row.currency ?? null,
        updatedAt,
      });
    }
  });
  insertMany(stocks);
}

/**
 * Substring match on name or symbol (case-insensitive), newest-updated first,
 * capped at `limit`. Returns [] for a blank query.
 */
export function searchStockDirectory(
  query: string,
  limit = 20,
  db: Database.Database = getDb(),
): DirectoryStock[] {
  const trimmed = query.trim();
  if (trimmed === "") {
    return [];
  }
  const like = `%${trimmed}%`;
  const rows = db
    .prepare(
      `SELECT symbol, name, market, currency FROM stock_directory
       WHERE name LIKE ? COLLATE NOCASE OR symbol LIKE ? COLLATE NOCASE
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(like, like, limit);
  return (rows as DirectoryRow[]).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    currency: row.currency,
  }));
}
