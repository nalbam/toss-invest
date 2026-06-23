import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";
import type { MarketAdvisorResult } from "./schema";

// Persistent log of every market (chart) advisor run, backed by SQLite. Writes
// are best-effort (a logging failure must never break the advisor response);
// reads return [] on failure. The returned shape (MarketAdviceHistoryRecord) is
// kept stable so the chart overlay consumer is unaffected by the storage change.

type Decision = MarketAdvisorResult["decision"];
type Annotations = MarketAdvisorResult["annotations"];

export interface MarketAdviceRecord {
  symbol: string;
  interval: string;
  generatedAt: string;
  chartTimestamp: string | null;
  lastPrice?: string;
  decision: Decision;
  advice: string;
  annotations?: Annotations;
}

export interface MarketAdviceHistoryRecord {
  symbol: string;
  interval: string;
  generatedAt: string;
  chartTimestamp: string | null;
  lastPrice?: string;
  decision: Decision;
  advice: string;
  cachedAt: string;
}

interface MarketAdviceRow {
  symbol: string;
  interval: string;
  generated_at: string;
  chart_timestamp: string | null;
  last_price: string | null;
  decision_action: string;
  decision_label: string;
  decision_reason: string;
  advice: string;
  created_at: string;
}

function rowToHistory(row: MarketAdviceRow): MarketAdviceHistoryRecord {
  return {
    symbol: row.symbol,
    interval: row.interval,
    generatedAt: row.generated_at,
    chartTimestamp: row.chart_timestamp,
    lastPrice: row.last_price ?? undefined,
    decision: {
      action: row.decision_action as Decision["action"],
      label: row.decision_label,
      reason: row.decision_reason,
    },
    advice: row.advice,
    cachedAt: row.created_at,
  };
}

export function recordMarketAdvice(
  record: MarketAdviceRecord,
  db: Database.Database = getDb(),
): void {
  try {
    db.prepare(
      `INSERT INTO market_advice
        (symbol, interval, generated_at, chart_timestamp, last_price,
         decision_action, decision_label, decision_reason, advice, annotations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.symbol,
      record.interval,
      record.generatedAt,
      record.chartTimestamp,
      record.lastPrice ?? null,
      record.decision.action,
      record.decision.label,
      record.decision.reason,
      record.advice,
      record.annotations ? JSON.stringify(record.annotations) : null,
      new Date().toISOString(),
    );
  } catch {
    // Best-effort: durable logging must not fail the upstream response.
  }
}

export function readMarketAdviceHistory(
  { symbol, interval, limit }: { symbol: string; interval?: string; limit: number },
  db: Database.Database = getDb(),
): MarketAdviceHistoryRecord[] {
  try {
    const rows =
      interval === undefined
        ? db
            .prepare(
              `SELECT * FROM market_advice WHERE symbol = ? ORDER BY id DESC LIMIT ?`,
            )
            .all(symbol, limit)
        : db
            .prepare(
              `SELECT * FROM market_advice
               WHERE symbol = ? AND interval = ? ORDER BY id DESC LIMIT ?`,
            )
            .all(symbol, interval, limit);
    return (rows as MarketAdviceRow[]).map(rowToHistory);
  } catch {
    return [];
  }
}
