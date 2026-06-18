import { describe, expect, it } from "vitest";
import { thresholdExitStrategy } from "@/lib/server/trading/strategy/threshold-exit";
import type {
  PositionSnapshot,
  StrategyParams,
  StrategySnapshot,
} from "@/lib/server/trading/strategy/types";

// --- fixtures ---------------------------------------------------------------

/** Baseline position: in-band, full weight headroom; overridden per test. */
function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    symbol: "005930",
    currency: "KRW",
    quantity: "100",
    profitLossRate: 0.05,
    dailyProfitLossRate: 0.0,
    weightPct: 10,
    ...overrides,
  };
}

function snapshot(positions: PositionSnapshot[]): StrategySnapshot {
  return { positions };
}

/** stop-loss -10%, take-profit +20%, concentration cap 30%. */
const params: StrategyParams = {
  stopLossRate: -0.1,
  takeProfitRate: 0.2,
  maxWeightPct: 30,
};

// --- tests ------------------------------------------------------------------

describe("thresholdExitStrategy", () => {
  it("exits the full position on stop-loss", () => {
    const intents = thresholdExitStrategy(
      snapshot([position({ profitLossRate: -0.12 })]),
      params,
    );
    expect(intents).toEqual([
      {
        symbol: "005930",
        currency: "KRW",
        side: "SELL",
        orderType: "MARKET",
        quantity: "100",
        reason: "stop-loss",
      },
    ]);
  });

  it("exits the full position on take-profit", () => {
    const intents = thresholdExitStrategy(
      snapshot([position({ profitLossRate: 0.25 })]),
      params,
    );
    expect(intents).toEqual([
      {
        symbol: "005930",
        currency: "KRW",
        side: "SELL",
        orderType: "MARKET",
        quantity: "100",
        reason: "take-profit",
      },
    ]);
  });

  it("triggers stop-loss / take-profit exactly at the threshold", () => {
    const atStop = thresholdExitStrategy(
      snapshot([position({ symbol: "AAA", profitLossRate: -0.1 })]),
      params,
    );
    expect(atStop[0]?.reason).toBe("stop-loss");

    const atTake = thresholdExitStrategy(
      snapshot([position({ symbol: "BBB", profitLossRate: 0.2 })]),
      params,
    );
    expect(atTake[0]?.reason).toBe("take-profit");
  });

  it("proposes nothing inside the band", () => {
    const intents = thresholdExitStrategy(
      snapshot([position({ profitLossRate: 0.05 })]),
      params,
    );
    expect(intents).toEqual([]);
  });

  it("trims the concentration excess as a partial SELL", () => {
    // floor(100 * (50 - 30) / 50) = floor(40) = 40.
    const intents = thresholdExitStrategy(
      snapshot([position({ weightPct: 50, quantity: "100" })]),
      params,
    );
    expect(intents).toEqual([
      {
        symbol: "005930",
        currency: "KRW",
        side: "SELL",
        orderType: "MARKET",
        quantity: "40",
        reason: "concentration-trim",
      },
    ]);
  });

  it("proposes nothing when the trim floors to zero shares", () => {
    // floor(10 * (31 - 30) / 31) = floor(0.32...) = 0 -> no intent.
    const intents = thresholdExitStrategy(
      snapshot([position({ weightPct: 31, quantity: "10" })]),
      params,
    );
    expect(intents).toEqual([]);
  });

  it("does not trim when maxWeightPct is unset", () => {
    const noCap: StrategyParams = {
      stopLossRate: params.stopLossRate,
      takeProfitRate: params.takeProfitRate,
    };
    const intents = thresholdExitStrategy(
      snapshot([position({ weightPct: 90 })]),
      noCap,
    );
    expect(intents).toEqual([]);
  });

  it("prefers stop-loss over take-profit when both could match", () => {
    // A negative-enough rate can only satisfy stop-loss, but assert that the
    // stop-loss branch is checked first by using params where stopLoss is
    // positive and below takeProfit so a value satisfies *both* conditions.
    const overlapping: StrategyParams = {
      stopLossRate: 0.3,
      takeProfitRate: 0.2,
    };
    const intents = thresholdExitStrategy(
      snapshot([position({ profitLossRate: 0.25 })]),
      overlapping,
    );
    expect(intents[0]?.reason).toBe("stop-loss");
  });

  it("never proposes a BUY (SELL-only strategy)", () => {
    const intents = thresholdExitStrategy(
      snapshot([
        position({ symbol: "AAA", profitLossRate: -0.5 }),
        position({ symbol: "BBB", profitLossRate: 0.9 }),
        position({ symbol: "CCC", weightPct: 80 }),
      ]),
      params,
    );
    expect(intents.every((intent) => intent.side === "SELL")).toBe(true);
  });

  it("sorts mixed-symbol output ascending with integer quantities", () => {
    const intents = thresholdExitStrategy(
      snapshot([
        position({ symbol: "ZZZ", profitLossRate: 0.25, quantity: "7" }),
        position({ symbol: "AAA", profitLossRate: -0.2, quantity: "3" }),
        // in-band, dropped from the output.
        position({ symbol: "MMM", profitLossRate: 0.05 }),
        position({ symbol: "AMD", weightPct: 50, quantity: "100" }),
      ]),
      params,
    );
    expect(intents.map((intent) => intent.symbol)).toEqual([
      "AAA",
      "AMD",
      "ZZZ",
    ]);
    expect(intents.map((intent) => intent.quantity)).toEqual(["3", "40", "7"]);
    // Every quantity is a plain integer string (no decimal point).
    expect(intents.every((intent) => /^\d+$/.test(intent.quantity))).toBe(true);
  });

  it("preserves each position's currency on the intent", () => {
    const intents = thresholdExitStrategy(
      snapshot([
        position({ symbol: "AAPL", currency: "USD", profitLossRate: 0.25 }),
        position({ symbol: "005930", currency: "KRW", profitLossRate: -0.2 }),
      ]),
      params,
    );
    const bySymbol = Object.fromEntries(
      intents.map((intent) => [intent.symbol, intent.currency]),
    );
    expect(bySymbol).toEqual({ AAPL: "USD", "005930": "KRW" });
  });

  it("ignores zero-quantity positions", () => {
    const intents = thresholdExitStrategy(
      snapshot([position({ quantity: "0", profitLossRate: -0.5 })]),
      params,
    );
    expect(intents).toEqual([]);
  });

  it("returns an empty list for an empty snapshot", () => {
    expect(thresholdExitStrategy(snapshot([]), params)).toEqual([]);
  });

  it("is deterministic: the same input yields an equal result", () => {
    const input = snapshot([
      position({ symbol: "ZZZ", profitLossRate: 0.25 }),
      position({ symbol: "AAA", weightPct: 60, quantity: "100" }),
    ]);
    expect(thresholdExitStrategy(input, params)).toEqual(
      thresholdExitStrategy(input, params),
    );
  });
});
