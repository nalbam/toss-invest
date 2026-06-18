import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/server/trading/backtest/simulate";
import type {
  BacktestInput,
  BacktestSymbolInput,
} from "@/lib/server/trading/backtest/types";
import type {
  OrderIntent,
  Strategy,
} from "@/lib/server/trading/strategy/types";

// --- fixtures ---------------------------------------------------------------

/** stop-loss -10%, take-profit +20%, concentration cap 30%. */
const params: BacktestInput["params"] = {
  stopLossRate: -0.1,
  takeProfitRate: 0.2,
  maxWeightPct: 30,
};

/**
 * Same thresholds without a concentration cap. Used for single-symbol scenarios
 * where a lone position always weighs 100% of the portfolio (and would
 * otherwise be trimmed), so the stop-loss / take-profit / hold behaviour can be
 * exercised in isolation. Concentration-trim has its own dedicated test.
 */
const paramsNoCap: BacktestInput["params"] = {
  stopLossRate: -0.1,
  takeProfitRate: 0.2,
};

/** A KRW symbol bought at 100 KRW, 10 shares, flat closes; overridden per test. */
function krwSymbol(
  overrides: Partial<BacktestSymbolInput> = {},
): BacktestSymbolInput {
  return {
    symbol: "005930",
    currency: "KRW",
    initialQuantity: "10",
    avgCost: "100",
    closes: ["100", "100", "100"],
    ...overrides,
  };
}

// --- tests ------------------------------------------------------------------

describe("runBacktest", () => {
  it("exits the full position on stop-loss with exact realized PnL", () => {
    // avgCost 100, qty 10. Step 1 close 88 => rate -0.12 <= -0.10 => full SELL.
    const result = runBacktest({
      symbols: [krwSymbol({ closes: ["100", "88", "80"] })],
      params: paramsNoCap,
    });

    expect(result.trades).toEqual([
      {
        step: 1,
        symbol: "005930",
        side: "SELL",
        quantity: "10",
        price: "88",
        reason: "stop-loss",
        realizedPnlKrw: 10 * (88 - 100), // -120
      },
    ]);
    expect(result.finalPositions).toEqual([{ symbol: "005930", quantity: "0" }]);
    expect(result.realizedPnlKrw).toBe(-120);
    expect(result.metrics).toEqual({
      tradeCount: 1,
      realizedPnlKrw: -120,
      bySymbol: { "005930": { sold: "10", realizedPnlKrw: -120 } },
      skippedSymbols: [],
    });
  });

  it("exits the full position on take-profit with exact realized PnL", () => {
    // Step 2 close 125 => rate +0.25 >= +0.20 => full SELL.
    const result = runBacktest({
      symbols: [krwSymbol({ closes: ["100", "110", "125"] })],
      params: paramsNoCap,
    });

    expect(result.trades).toEqual([
      {
        step: 2,
        symbol: "005930",
        side: "SELL",
        quantity: "10",
        price: "125",
        reason: "take-profit",
        realizedPnlKrw: 10 * (125 - 100), // 250
      },
    ]);
    expect(result.realizedPnlKrw).toBe(250);
    expect(result.finalPositions).toEqual([{ symbol: "005930", quantity: "0" }]);
  });

  it("holds with no trades while the price stays inside the band", () => {
    // Closes 100/105/95 => rates 0 / +0.05 / -0.05, all inside the band.
    const result = runBacktest({
      symbols: [krwSymbol({ closes: ["100", "105", "95"] })],
      params: paramsNoCap,
    });

    expect(result.trades).toEqual([]);
    expect(result.realizedPnlKrw).toBe(0);
    expect(result.finalPositions).toEqual([
      { symbol: "005930", quantity: "10" },
    ]);
    expect(result.metrics.tradeCount).toBe(0);
    expect(result.metrics.bySymbol).toEqual({});
  });

  it("does not trade a symbol again after it is fully sold", () => {
    // Drops below stop-loss at step 1 and stays there; sells exactly once.
    const result = runBacktest({
      symbols: [krwSymbol({ closes: ["100", "80", "70", "60"] })],
      params: paramsNoCap,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.step).toBe(1);
    expect(result.finalPositions).toEqual([{ symbol: "005930", quantity: "0" }]);
  });

  it("partially sells the over-concentrated symbol (concentration trim)", () => {
    // Two KRW symbols over a single step, both flat (in band on PnL). AAA value
    // 100*100=10000, BBB value 10*100=1000 => total 11000 => AAA weight
    // ~90.909% > 30%. trim = floor(100 * (90.909.. - 30) / 90.909..)
    // = floor(67.0) = 67. A single step exercises one trim deterministically.
    const result = runBacktest({
      symbols: [
        krwSymbol({ symbol: "AAA", initialQuantity: "100", avgCost: "100", closes: ["100"] }),
        krwSymbol({ symbol: "BBB", initialQuantity: "10", avgCost: "100", closes: ["100"] }),
      ],
      params,
    });

    expect(result.trades).toEqual([
      {
        step: 0,
        symbol: "AAA",
        side: "SELL",
        quantity: "67",
        price: "100",
        reason: "concentration-trim",
        // Trim PnL is realized at the flat close: avgCost == close => 0 PnL.
        realizedPnlKrw: 0,
      },
    ]);
    expect(result.finalPositions).toEqual([
      { symbol: "AAA", quantity: "33" },
      { symbol: "BBB", quantity: "10" },
    ]);
    expect(result.trades.some((t) => t.symbol === "BBB")).toBe(false);
  });

  it("emits trades in (step, symbol) order", () => {
    // AAA stop-losses at step 0; BBB take-profits at step 1.
    const result = runBacktest({
      symbols: [
        krwSymbol({ symbol: "BBB", closes: ["100", "130"] }),
        krwSymbol({ symbol: "AAA", closes: ["80", "80"] }),
      ],
      params: paramsNoCap,
    });

    expect(result.trades.map((t) => [t.step, t.symbol])).toEqual([
      [0, "AAA"],
      [1, "BBB"],
    ]);
  });

  it("skips USD symbols when no fxRate is supplied and records them", () => {
    // The USD symbol would stop-loss, but without fxRate it cannot be valued in
    // KRW, so it is excluded from the run entirely.
    const result = runBacktest({
      symbols: [
        krwSymbol({ symbol: "005930", closes: ["100", "80"] }),
        {
          symbol: "AAPL",
          currency: "USD",
          initialQuantity: "5",
          avgCost: "200",
          closes: ["200", "150"],
        },
      ],
      params: paramsNoCap,
    });

    expect(result.metrics.skippedSymbols).toEqual(["AAPL"]);
    expect(result.trades.every((t) => t.symbol !== "AAPL")).toBe(true);
    expect(result.finalPositions.map((p) => p.symbol)).toEqual(["005930"]);
  });

  it("realizes USD PnL in KRW via fxRate", () => {
    // avgCost 200, close 250 (+25% => take-profit), 5 shares, fxRate 1300.
    // realizedPnlKrw = 5 * (250 - 200) * 1300 = 325000.
    const result = runBacktest({
      symbols: [
        {
          symbol: "AAPL",
          currency: "USD",
          initialQuantity: "5",
          avgCost: "200",
          closes: ["200", "250"],
        },
      ],
      params: paramsNoCap,
      fxRate: 1300,
    });

    expect(result.metrics.skippedSymbols).toEqual([]);
    expect(result.trades).toEqual([
      {
        step: 1,
        symbol: "AAPL",
        side: "SELL",
        quantity: "5",
        price: "250",
        reason: "take-profit",
        realizedPnlKrw: 325000,
      },
    ]);
    expect(result.realizedPnlKrw).toBe(325000);
  });

  it("replays only up to the shortest series on a length mismatch", () => {
    // AAA has 2 closes, BBB has 4. Steps run 0..1. BBB would take-profit at
    // step 3, but that step is never reached, so BBB never trades.
    const result = runBacktest({
      symbols: [
        krwSymbol({ symbol: "AAA", closes: ["100", "80"] }),
        krwSymbol({ symbol: "BBB", closes: ["100", "100", "100", "130"] }),
      ],
      params: paramsNoCap,
    });

    expect(result.trades.map((t) => [t.step, t.symbol])).toEqual([[1, "AAA"]]);
    expect(result.finalPositions).toEqual([
      { symbol: "AAA", quantity: "0" },
      { symbol: "BBB", quantity: "10" },
    ]);
  });

  it("caps the sold quantity at the held shares", () => {
    // A strategy that over-asks (sells 999) must only realize the 10 held.
    const greedy: Strategy = (snapshot) =>
      snapshot.positions.map(
        (p): OrderIntent => ({
          symbol: p.symbol,
          currency: p.currency,
          side: "SELL",
          orderType: "MARKET",
          quantity: "999",
          reason: "test-greedy",
        }),
      );

    const result = runBacktest({
      symbols: [krwSymbol({ closes: ["100", "100"] })],
      params,
      strategy: greedy,
    });

    expect(result.trades[0]?.quantity).toBe("10");
    expect(result.finalPositions).toEqual([{ symbol: "005930", quantity: "0" }]);
    // Sold once at step 0; nothing left to sell at step 1.
    expect(result.trades).toHaveLength(1);
  });

  it("is deterministic: the same input yields a deep-equal result", () => {
    const input: BacktestInput = {
      symbols: [
        krwSymbol({ symbol: "AAA", closes: ["100", "80", "70"] }),
        krwSymbol({ symbol: "ZZZ", closes: ["100", "110", "130"] }),
        {
          symbol: "AAPL",
          currency: "USD",
          initialQuantity: "5",
          avgCost: "200",
          closes: ["200", "260", "260"],
        },
      ],
      params,
      fxRate: 1300,
    };

    expect(runBacktest(input)).toEqual(runBacktest(input));
  });

  it("returns an empty result for no symbols", () => {
    const result = runBacktest({ symbols: [], params });
    expect(result).toEqual({
      trades: [],
      finalPositions: [],
      realizedPnlKrw: 0,
      metrics: {
        tradeCount: 0,
        realizedPnlKrw: 0,
        bySymbol: {},
        skippedSymbols: [],
      },
    });
  });
});
