import "server-only";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/server/db/sqlite";
import type { AuditEntry, OrderOpAuditEntry } from "@/lib/server/trading/safety";

// Durable §6 trading audit log. Every gated order attempt (place/modify/cancel) —
// SEND, DRY_RUN, or BLOCK — is recorded here in addition to the console line. The
// entry is already secret-free (safety.ts summarizes/masks before logging), so a
// row carries only an order/op summary, the gate decision, and its reasons.

/** Discriminates the entry: a place-order attempt vs a modify/cancel op. */
function auditKind(entry: AuditEntry | OrderOpAuditEntry): string {
  return "op" in entry ? entry.op : "place";
}

/** Inserts one audit entry. Never mutates the entry. */
export function insertAuditEntry(
  entry: AuditEntry | OrderOpAuditEntry,
  db: Database.Database = getDb(),
): void {
  const symbol = "order" in entry ? entry.order.symbol : null;
  const orderId = "orderId" in entry ? entry.orderId : null;
  db.prepare(
    `INSERT INTO trading_audit
       (at, kind, decision, reasons, account_seq, symbol, order_id,
        notional_krw, high_value, entry, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.at,
    auditKind(entry),
    entry.decision,
    JSON.stringify(entry.reasons),
    String(entry.accountSeq),
    symbol,
    orderId,
    entry.notionalKrw ?? null,
    entry.highValue ? 1 : 0,
    JSON.stringify(entry),
    new Date().toISOString(),
  );
}
