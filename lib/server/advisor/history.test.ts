import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/server/db/sqlite";
import { recordPortfolioAdvice, readPortfolioAdviceHistory } from "./history";
import type { ValidatedProposal } from "./validate";

function makeDb() {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

const proposals: ValidatedProposal[] = [
  {
    proposal: { kind: "buy", symbol: "005930", side: "BUY", quantity: 1, rationale: "r" },
    valid: true,
    reasons: [],
  },
];

describe("portfolio advice history", () => {
  it("records and reads back with proposals JSON round-trip", () => {
    const db = makeDb();
    recordPortfolioAdvice(
      { accountSeq: 7, generatedAt: "2026-06-23T00:00:00Z", model: "m", advice: "a", proposals },
      db,
    );
    const rows = readPortfolioAdviceHistory({ accountSeq: 7, limit: 10 }, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].proposals).toEqual(proposals);
    expect(rows[0].model).toBe("m");
    expect(typeof rows[0].cachedAt).toBe("string");
  });

  it("filters by accountSeq and lists all when omitted", () => {
    const db = makeDb();
    recordPortfolioAdvice(
      { accountSeq: 1, generatedAt: "t", model: "m", advice: "a1", proposals: [] },
      db,
    );
    recordPortfolioAdvice(
      { accountSeq: 2, generatedAt: "t", model: "m", advice: "a2", proposals: [] },
      db,
    );
    expect(readPortfolioAdviceHistory({ accountSeq: 1, limit: 10 }, db)).toHaveLength(1);
    expect(readPortfolioAdviceHistory({ limit: 10 }, db)).toHaveLength(2);
  });

  it("stores a missing accountSeq as null", () => {
    const db = makeDb();
    recordPortfolioAdvice(
      { generatedAt: "t", model: "m", advice: "a", proposals: [] },
      db,
    );
    const rows = readPortfolioAdviceHistory({ limit: 10 }, db);
    expect(rows[0].accountSeq).toBeUndefined();
  });
});
