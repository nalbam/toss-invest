import "server-only";

/**
 * Phase 3 strategy *intent* layer — pure types only. A strategy reads a snapshot
 * of the current positions and produces a list of `OrderIntent`s (what it would
 * propose to trade). It performs NO I/O and never sends an order; turning an
 * intent into a real order is the executor's job (#18), behind the §6 gate.
 *
 * Decimal money/quantity fields follow the same convention as the Toss schemas
 * (`schemas.ts`): they are strings, never JS numbers, so precision is never
 * silently lost. Quantities are integer share counts (`^\d+$`).
 */

/** One held position, as the strategy sees it. */
export interface PositionSnapshot {
  symbol: string;
  currency: "KRW" | "USD";
  /** Held share count: a decimal *integer* string. */
  quantity: string;
  /** Total profit/loss as a fraction (0.15 = +15%, -0.10 = -10%). */
  profitLossRate: number;
  /** Today's profit/loss as a fraction. */
  dailyProfitLossRate: number;
  /** Portfolio weight, 0..100 (percent). */
  weightPct: number;
  /** Last traded price (native currency), when known. */
  lastPrice?: string;
}

/** Input to a strategy: the set of current positions. */
export interface StrategySnapshot {
  positions: PositionSnapshot[];
}

/**
 * A single proposed order. `quantity` is an integer share-count string
 * (`^\d+$`); `price` is present only for LIMIT orders. `reason` is a short,
 * machine-stable tag (e.g. `"stop-loss"`) for the audit trail.
 */
export interface OrderIntent {
  symbol: string;
  currency: "KRW" | "USD";
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  /** Integer share count, `^\d+$`. */
  quantity: string;
  price?: string;
  reason: string;
}

/** Tunable thresholds shared across the rule-based strategies. */
export interface StrategyParams {
  /** Total-loss fraction at/below which a position is exited (e.g. -0.10). */
  stopLossRate: number;
  /** Total-gain fraction at/above which a position is exited (e.g. 0.20). */
  takeProfitRate: number;
  /** Concentration cap as a percent (0..100); positions above it are trimmed. */
  maxWeightPct?: number;
}

/** A strategy is a pure function: snapshot + params -> proposed intents. */
export type Strategy = (
  snapshot: StrategySnapshot,
  params: StrategyParams,
) => OrderIntent[];
