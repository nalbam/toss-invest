import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";
import type { ValidatedProposal } from "./validate";

// Persistent log of every portfolio advisor run, backed by SQLite. Writes are
// best-effort; reads return [] on failure. Proposals are stored as a JSON blob
// (they are a structured array, not queried column-wise).

export interface PortfolioAdviceRecord {
  accountSeq?: number;
  generatedAt: string;
  model: string;
  advice: string;
  proposals: ValidatedProposal[];
}

export interface PortfolioAdviceHistoryRecord extends PortfolioAdviceRecord {
  cachedAt: string;
}

interface PortfolioAdviceRow {
  account_seq: number | null;
  generated_at: string;
  model: string;
  advice: string;
  proposals: string;
  created_at: string;
}

function rowToHistory(row: PortfolioAdviceRow): PortfolioAdviceHistoryRecord {
  let proposals: ValidatedProposal[] = [];
  try {
    const parsed: unknown = JSON.parse(row.proposals);
    if (Array.isArray(parsed)) {
      proposals = parsed as ValidatedProposal[];
    }
  } catch {
    proposals = [];
  }
  return {
    accountSeq: row.account_seq ?? undefined,
    generatedAt: row.generated_at,
    model: row.model,
    advice: row.advice,
    proposals,
    cachedAt: row.created_at,
  };
}

export function recordPortfolioAdvice(
  record: PortfolioAdviceRecord,
  db: Database.Database = getDb(),
): void {
  try {
    db.prepare(
      `INSERT INTO portfolio_advice
        (account_seq, generated_at, model, advice, proposals, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      record.accountSeq ?? null,
      record.generatedAt,
      record.model,
      record.advice,
      JSON.stringify(record.proposals),
      new Date().toISOString(),
    );
  } catch {
    // Best-effort: durable logging must not fail the upstream response.
  }
}

export function readPortfolioAdviceHistory(
  { accountSeq, limit }: { accountSeq?: number; limit: number },
  db: Database.Database = getDb(),
): PortfolioAdviceHistoryRecord[] {
  try {
    const rows =
      accountSeq === undefined
        ? db
            .prepare(`SELECT * FROM portfolio_advice ORDER BY id DESC LIMIT ?`)
            .all(limit)
        : db
            .prepare(
              `SELECT * FROM portfolio_advice WHERE account_seq = ? ORDER BY id DESC LIMIT ?`,
            )
            .all(accountSeq, limit);
    return (rows as PortfolioAdviceRow[]).map(rowToHistory);
  } catch {
    return [];
  }
}
