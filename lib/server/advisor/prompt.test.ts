import { describe, expect, it } from "vitest";
import { buildAdvisorPrompt } from "./prompt";
import type { AdvisorSnapshot } from "./snapshot";

const snapshot: AdvisorSnapshot = {
  holdings: [
    {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      quantity: "10",
      lastPrice: "700",
      averagePurchasePrice: "650",
      marketValue: "7000",
      profitLoss: "500",
      profitLossRate: "0.077",
      weightPercent: 70,
    },
  ],
  cash: { currency: "KRW", buyingPower: "1234567" },
  exchangeRate: { baseCurrency: "USD", quoteCurrency: "KRW", rate: "1350.5" },
};

describe("buildAdvisorPrompt", () => {
  it("returns a system message followed by a user message", () => {
    const messages = buildAdvisorPrompt(snapshot);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("states the proposer-not-executor guardrail in the system message", () => {
    const system = buildAdvisorPrompt(snapshot)[0].content;
    expect(system).toMatch(/제안/);
    expect(system).toMatch(/집행|실행|주문/);
  });

  it("describes the proposal fields the model must return", () => {
    const system = buildAdvisorPrompt(snapshot)[0].content;
    for (const field of ["kind", "symbol", "side", "quantity"]) {
      expect(system).toContain(field);
    }
  });

  it("embeds the masked snapshot in the user message", () => {
    const user = buildAdvisorPrompt(snapshot)[1].content;
    expect(user).toContain("005930");
    expect(user).toContain("1234567");
    expect(user).toContain("1350.5");
  });

  it("is deterministic for the same snapshot", () => {
    expect(buildAdvisorPrompt(snapshot)).toEqual(buildAdvisorPrompt(snapshot));
  });

  it("does not leak any account identifier text", () => {
    const serialized = JSON.stringify(buildAdvisorPrompt(snapshot));
    for (const forbidden of ["accountNo", "accountSeq", "accountType"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
