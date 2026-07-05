import { describe, expect, it, vi } from "vitest";

// The route reads the SQLite-backed advice log; point it at an in-memory DB so
// these tests never touch the real data/advisor.db.
process.env.ADVISOR_DB_PATH = ":memory:";

// Plain function (not vi.fn) so the route sees an authenticated session under
// `withAuth`.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "test" } }) } },
}));

import { GET } from "@/app/api/advisor/history/route";
import { recordPortfolioAdvice } from "@/lib/server/advisor/history";

function getReq(query: string): Request {
  return new Request(`http://localhost/api/advisor/history${query}`);
}

describe("GET /api/advisor/history", () => {
  it("returns persisted advice for an account, newest first", async () => {
    recordPortfolioAdvice({
      accountSeq: 11,
      generatedAt: "2026-07-01T00:00:00Z",
      model: "m",
      advice: "older",
      proposals: [],
    });
    recordPortfolioAdvice({
      accountSeq: 11,
      generatedAt: "2026-07-02T00:00:00Z",
      model: "m",
      advice: "newer",
      proposals: [
        {
          proposal: { kind: "trim", symbol: "005930", side: "SELL", quantity: 5, rationale: "r" },
          valid: true,
          reasons: [],
        },
      ],
    });

    const response = await GET(getReq("?accountSeq=11&limit=1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].advice).toBe("newer");
    expect(body.data.events[0].proposals[0].valid).toBe(true);
    expect(typeof body.data.events[0].cachedAt).toBe("string");
  });

  it("filters by accountSeq", async () => {
    recordPortfolioAdvice({
      accountSeq: 21,
      generatedAt: "t",
      model: "m",
      advice: "a21",
      proposals: [],
    });

    const response = await GET(getReq("?accountSeq=22"));
    const body = await response.json();
    expect(body.data.events).toHaveLength(0);
  });

  it("rejects a non-positive accountSeq", async () => {
    const response = await GET(getReq("?accountSeq=0"));
    expect(response.status).toBe(400);
  });

  it("rejects an out-of-range limit", async () => {
    const response = await GET(getReq("?limit=201"));
    expect(response.status).toBe(400);
  });
});
