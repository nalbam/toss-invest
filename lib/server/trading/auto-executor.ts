import "server-only";
import type { CreateOrderRawParams } from "@/lib/server/toss/endpoints";
import type {
  OrderCreateRequest,
  OrderCreateResponse,
} from "@/lib/server/toss/schemas";
import { placeOrder, type TradingConfig } from "@/lib/server/trading/safety";
import type { OrderIntent } from "@/lib/server/trading/strategy/types";

/**
 * Phase 3 gated auto-executor (intent -> §6 `placeOrder`). It turns a list of
 * strategy `OrderIntent`s into gated order attempts.
 *
 * SAFETY (does NOT live here; this only *calls* the §6 gate in `safety.ts`):
 *   - The per-order `confirm` is the human's out-of-band activation
 *     (`AUTO_TRADE_ENABLED`), passed through verbatim. This module NEVER mints,
 *     hard-codes, or promotes a confirm — an agent cannot arm itself.
 *   - Every intent still flows through `placeOrder`, so DRY_RUN default, the
 *     kill switch, the hard limit, and the high-value check all still apply. A
 *     MARKET order with an unknown reference price fails safe (notional-unknown
 *     => BLOCK). A real auto order is reachable ONLY when
 *     AUTO_TRADE_ENABLED ∧ DRY_RUN=false ∧ within limit ∧ kill off ∧ notional
 *     computable (and any high-value order separately confirmed).
 *   - There is NO standing loop / cron / setInterval here: `runAutoTrade` does a
 *     single evaluation per call. Scheduling is a separate human-triggered
 *     decision, out of this module's scope.
 */

/** Same raw-POST signature `placeOrder` consumes, injected so this stays I/O-free. */
type CreateOrderRawFn = (
  params: CreateOrderRawParams,
) => Promise<OrderCreateResponse>;

/**
 * Pure conversion of a strategy `OrderIntent` into a quantity-based
 * `OrderCreateRequest`. Mirrors the intent's `symbol`/`side`/`orderType`/
 * `quantity`; carries `price` only for LIMIT orders (MARKET must omit it per the
 * order schema). `timeInForce` defaults to `"DAY"` and `confirmHighValueOrder`
 * to `false` — a high-value auto order is left for the §6 gate to BLOCK rather
 * than silently confirmed here. No I/O, no clock, no randomness.
 */
export function intentToOrderRequest(intent: OrderIntent): OrderCreateRequest {
  const base = {
    symbol: intent.symbol,
    side: intent.side,
    orderType: intent.orderType,
    timeInForce: "DAY" as const,
    quantity: intent.quantity,
    confirmHighValueOrder: false,
  };
  if (intent.orderType === "LIMIT") {
    return { ...base, price: intent.price };
  }
  return base;
}

/** Per-intent outcome of an auto-trade pass. */
export interface AutoTradeItemResult {
  intent: OrderIntent;
  status: "SENT" | "DRY_RUN" | "BLOCKED";
  /** §6 gate reasons (present for DRY_RUN / BLOCKED). */
  reasons?: string[];
}

/** Aggregate counts over a single `runAutoTrade` pass. */
export interface AutoTradeSummary {
  sent: number;
  dryRun: number;
  blocked: number;
}

export interface AutoTradeResult {
  results: AutoTradeItemResult[];
  summary: AutoTradeSummary;
}

export interface RunAutoTradeDeps {
  config: TradingConfig;
  /**
   * The human's out-of-band auto-trade activation (`AUTO_TRADE_ENABLED`). Passed
   * straight through to `placeOrder` as the §6 `confirm`. MUST be the env value
   * as-is — never constant-folded to `true` or otherwise promoted.
   */
  autoTradeEnabled: boolean;
  /** Injectable for tests; defaults to the real §6 `placeOrder`. */
  placeOrderFn?: typeof placeOrder;
  createOrderRaw: CreateOrderRawFn;
  now: () => number;
  auditLog: Parameters<typeof placeOrder>[1]["auditLog"];
  accountSeq: number | string;
  /**
   * Native-currency reference price for a symbol (last traded price), used to
   * value a MARKET order at the gate. Returns `undefined` when unknown, so the
   * gate fails safe (notional-unknown => BLOCK). Never substitute a guess.
   */
  priceFor: (symbol: string) => number | undefined;
  /** USD->KRW rate for valuing USD symbols at the gate; omit for KRW-only runs. */
  fxRate?: number;
}

/**
 * Evaluates each intent through the §6 gate exactly once (no standing loop). For
 * each intent it builds the order request, sets the gate `confirm` to the human
 * `autoTradeEnabled` value, supplies a `referencePrice` for MARKET orders (from
 * `priceFor`, left `undefined` when unknown so the gate BLOCKs), and calls
 * `placeOrder`. `placeOrder` itself records each attempt to `auditLog`; this only
 * collects the per-intent decision and tallies a summary (no duplicate audit).
 */
export async function runAutoTrade(
  intents: OrderIntent[],
  deps: RunAutoTradeDeps,
): Promise<AutoTradeResult> {
  const place = deps.placeOrderFn ?? placeOrder;
  const results: AutoTradeItemResult[] = [];
  const summary: AutoTradeSummary = { sent: 0, dryRun: 0, blocked: 0 };

  for (const intent of intents) {
    const request = intentToOrderRequest(intent);
    // MARKET orders carry no price; value them via the native reference price.
    // A LIMIT order is valued from its own price, so it needs none.
    const referencePrice =
      intent.orderType === "MARKET" ? deps.priceFor(intent.symbol) : undefined;

    const result = await place(
      {
        request,
        // The human's env activation, passed through unchanged. No promotion.
        confirm: deps.autoTradeEnabled,
        fxRate: deps.fxRate,
        referencePrice,
      },
      {
        config: deps.config,
        createOrderRaw: deps.createOrderRaw,
        now: deps.now,
        auditLog: deps.auditLog,
        accountSeq: deps.accountSeq,
      },
    );

    if (result.status === "SENT") {
      summary.sent += 1;
      results.push({ intent, status: "SENT" });
    } else if (result.status === "DRY_RUN") {
      summary.dryRun += 1;
      results.push({ intent, status: "DRY_RUN", reasons: result.reasons });
    } else {
      summary.blocked += 1;
      results.push({ intent, status: "BLOCKED", reasons: result.reasons });
    }
  }

  return { results, summary };
}
