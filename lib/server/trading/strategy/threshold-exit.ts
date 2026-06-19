import "server-only";
import type {
  OrderIntent,
  PositionSnapshot,
  Strategy,
  StrategyParams,
} from "@/lib/server/trading/strategy/types";

/**
 * Threshold-exit strategy — a conservative, **risk-reducing (SELL-only)** rule
 * set. For each held position (quantity > 0) it proposes at most one SELL by
 * the following priority:
 *   a) profitLossRate <= stopLossRate          -> full SELL, reason "stop-loss".
 *   b) profitLossRate >= takeProfitRate         -> full SELL, reason "take-profit".
 *   c) maxWeightPct set and weightPct > it      -> partial SELL (trim) of
 *      floor(quantity * (weightPct - maxWeightPct) / weightPct) shares,
 *      reason "concentration-trim"; if that floors to 0, no intent.
 *   d) otherwise                                -> no intent.
 *
 * All proposed orders are MARKET SELLs with an integer share quantity; the
 * position's own currency is preserved. This strategy never proposes a BUY —
 * automated BUY is a riskier, opt-in concern left to a follow-up strategy.
 *
 * Deterministic: the output depends only on the inputs (no clock, no randomness,
 * no I/O), and the returned intents are sorted by `symbol` ascending so the same
 * snapshot always yields the same ordered list.
 */
export const thresholdExitStrategy: Strategy = (snapshot, params) => {
  const intents: OrderIntent[] = [];

  for (const position of snapshot.positions) {
    const intent = exitIntentFor(position, params);
    if (intent !== undefined) intents.push(intent);
  }

  return intents.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
};

/** Builds the at-most-one SELL intent for a single position, or undefined. */
function exitIntentFor(
  position: PositionSnapshot,
  params: StrategyParams,
): OrderIntent | undefined {
  // Quantity is a decimal integer string; floor guards any fractional input.
  const heldQuantity = Math.floor(Number(position.quantity));
  if (!Number.isFinite(heldQuantity) || heldQuantity <= 0) return undefined;

  // (a) Stop-loss takes priority over every other rule.
  if (position.profitLossRate <= params.stopLossRate) {
    return sellIntent(position, heldQuantity, "stop-loss");
  }

  // (b) Take-profit.
  if (position.profitLossRate >= params.takeProfitRate) {
    return sellIntent(position, heldQuantity, "take-profit");
  }

  // (c) Concentration trim: sell down the excess weight, floored to whole
  // shares. weightPct must be > 0 here (it is strictly above maxWeightPct >= 0).
  if (
    params.maxWeightPct !== undefined &&
    position.weightPct > params.maxWeightPct
  ) {
    const trimQuantity = Math.floor(
      (heldQuantity * (position.weightPct - params.maxWeightPct)) /
        position.weightPct,
    );
    if (trimQuantity <= 0) return undefined;
    return sellIntent(position, trimQuantity, "concentration-trim");
  }

  // (d) Inside the band: nothing to do.
  return undefined;
}

/** A MARKET SELL of `quantity` (integer) shares in the position's currency. */
function sellIntent(
  position: PositionSnapshot,
  quantity: number,
  reason: string,
): OrderIntent {
  return {
    symbol: position.symbol,
    currency: position.currency,
    side: "SELL",
    orderType: "MARKET",
    quantity: String(quantity),
    reason,
  };
}
