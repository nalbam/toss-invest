import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import { insertAuditEntry } from "./audit-store";
import type { AuditEntry, OrderOpAuditEntry } from "./safety";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

interface AuditRow {
  kind: string;
  decision: string;
  reasons: string;
  account_seq: string;
  symbol: string | null;
  order_id: string | null;
  notional_krw: number | null;
  high_value: number;
  entry: string;
}

describe("trading audit store", () => {
  it("persists a place-order audit entry", () => {
    const db = makeDb();
    const entry: AuditEntry = {
      at: 1000,
      decision: "SEND",
      reasons: ["gate-passed"],
      accountSeq: 42,
      order: {
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "10",
        price: "700",
      },
      notionalKrw: 7000,
      highValue: false,
    };

    insertAuditEntry(entry, db);

    const rows = db
      .prepare("SELECT * FROM trading_audit")
      .all() as AuditRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "place",
      decision: "SEND",
      account_seq: "42",
      symbol: "005930",
      order_id: null,
      notional_krw: 7000,
      high_value: 0,
    });
    expect(JSON.parse(rows[0].reasons)).toEqual(["gate-passed"]);
    expect(JSON.parse(rows[0].entry)).toMatchObject({ decision: "SEND" });
  });

  it("persists a modify/cancel audit entry tagged with its operation", () => {
    const db = makeDb();
    const entry: OrderOpAuditEntry = {
      at: 2000,
      op: "cancel",
      decision: "BLOCK",
      reasons: ["kill-switch-on"],
      accountSeq: 7,
      orderId: "ORD-1",
      highValue: false,
    };

    insertAuditEntry(entry, db);

    const row = db.prepare("SELECT * FROM trading_audit").get() as AuditRow;
    expect(row).toMatchObject({
      kind: "cancel",
      decision: "BLOCK",
      order_id: "ORD-1",
      symbol: null,
    });
  });
});
