import "server-only";
import type {
  Strategy,
  StrategyParams,
} from "@/lib/server/trading/strategy/types";

/**
 * Phase 3 backtest / simulation harness — pure types only. The harness replays
 * a strategy over a sequence of closing prices against a *virtual* portfolio and
 * tallies realized PnL. It performs NO I/O, sends NO real orders, and touches no
 * network: it is a deterministic function of its input (no clock, no randomness).
 *
 * Decimal money/quantity fields follow the same convention as the strategy and
 * Toss schemas: they are strings, never JS numbers, so share counts and native
 * prices never silently lose precision. Realized PnL is expressed in KRW as a
 * JS number (`realizedPnlKrw`) because it is an aggregate metric, not an order
 * field.
 */

/** One symbol's starting position plus its per-step closing-price series. */
export interface BacktestSymbolInput {
  symbol: string;
  currency: "KRW" | "USD";
  /** Starting share count: a decimal *integer* string (`^\d+$`). */
  initialQuantity: string;
  /** Native-currency average purchase price (constant across the run). */
  avgCost: string;
  /** Per-step closing prices in native currency; index t is step t. */
  closes: string[];
}

/**
 * Backtest input: the symbols to replay, the strategy thresholds, and the FX
 * rate used to value/realize USD symbols in KRW. `strategy` defaults to
 * `thresholdExitStrategy` when omitted.
 */
export interface BacktestInput {
  symbols: BacktestSymbolInput[];
  params: StrategyParams;
  /** USD->KRW rate, used to value USD weights and realize USD PnL in KRW. */
  fxRate?: number;
  strategy?: Strategy;
}

/** A single SELL applied to the virtual portfolio at a given step. */
export interface BacktestTrade {
  step: number;
  symbol: string;
  side: "SELL";
  /** Shares sold: a decimal integer string (`^\d+$`). */
  quantity: string;
  /** That step's closing price (native currency). */
  price: string;
  reason: string;
  /** Realized PnL of this sell in KRW (USD realized via `fxRate`). */
  realizedPnlKrw: number;
}

/** Aggregated result of a backtest run. */
export interface BacktestResult {
  trades: BacktestTrade[];
  /** Remaining holdings after the run (integer string quantities). */
  finalPositions: Array<{ symbol: string; quantity: string }>;
  realizedPnlKrw: number;
  metrics: {
    tradeCount: number;
    realizedPnlKrw: number;
    bySymbol: Record<string, { sold: string; realizedPnlKrw: number }>;
    /**
     * Symbols excluded from the run because their KRW value could not be
     * determined (USD symbols with no `fxRate`). Sorted ascending.
     */
    skippedSymbols: string[];
  };
}
