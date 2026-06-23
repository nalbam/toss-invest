import { describe, expect, it } from "vitest";
import { validateProposals, type ValidationContext } from "./validate";
import type { AdvisorProposal } from "./schema";

const context: ValidationContext = {
  holdings: [
    { symbol: "005930", sellableQuantity: 10 },
    { symbol: "AAPL", sellableQuantity: 0 },
  ],
  knownSymbols: new Set(["005930", "AAPL", "000660"]),
};

function proposal(overrides: Partial<AdvisorProposal>): AdvisorProposal {
  return {
    kind: "trim",
    symbol: "005930",
    side: "SELL",
    quantity: 5,
    rationale: "reason",
    ...overrides,
  };
}

function validateOne(overrides: Partial<AdvisorProposal>) {
  return validateProposals([proposal(overrides)], context)[0];
}

describe("validateProposals", () => {
  it("accepts a SELL within the sellable quantity of a held symbol", () => {
    const result = validateOne({ side: "SELL", kind: "trim", quantity: 5 });
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("accepts a BUY of a known, tradable symbol", () => {
    const result = validateOne({ side: "BUY", kind: "buy", symbol: "000660", quantity: 3 });
    expect(result.valid).toBe(true);
  });

  it("rejects a SELL exceeding the sellable quantity (no auto-clamp)", () => {
    const result = validateOne({ side: "SELL", kind: "exit", quantity: 50 });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/sellable/i);
  });

  it("rejects a SELL of a symbol that is not held", () => {
    const result = validateOne({ side: "SELL", kind: "trim", symbol: "000660", quantity: 1 });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/not held|sellable/i);
  });

  it("rejects any proposal for an unknown / non-tradable symbol", () => {
    const result = validateOne({ side: "BUY", kind: "buy", symbol: "ZZZZ", quantity: 1 });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/unknown|tradable/i);
  });

  it("rejects an incoherent kind/side pair (trim must be SELL)", () => {
    const result = validateOne({ kind: "trim", side: "BUY", symbol: "000660", quantity: 1 });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/kind|side/i);
  });

  it("rejects a non-integer or non-positive quantity defensively", () => {
    expect(validateOne({ quantity: 1.5 }).valid).toBe(false);
    expect(validateOne({ quantity: 0 }).valid).toBe(false);
    expect(validateOne({ quantity: -2 }).valid).toBe(false);
  });

  it("flags each proposal independently in a mixed batch", () => {
    const results = validateProposals(
      [
        proposal({ side: "SELL", kind: "trim", quantity: 5 }), // valid
        proposal({ side: "SELL", kind: "exit", quantity: 999 }), // invalid
        proposal({ side: "BUY", kind: "buy", symbol: "000660", quantity: 2 }), // valid
      ],
      context,
    );
    expect(results.map((r) => r.valid)).toEqual([true, false, true]);
  });
});
