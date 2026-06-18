import "server-only";
import { getEnv } from "@/lib/server/env";
import type { CreateOrderRawParams } from "@/lib/server/toss/endpoints";
import type {
  OrderCreateRequest,
  OrderCreateResponse,
} from "@/lib/server/toss/schemas";

/**
 * ⚠️ META-GUARD (§6 — trading safety, NOT modifiable without human approval) ⚠️
 *
 * This file and its test (`safety.test.ts`) are the code-level barrier that
 * keeps real-money orders from being sent unintentionally. The safety
 * invariants below MUST NOT be weakened, skipped, or bypassed by an automated
 * loop:
 *   - DRY_RUN defaults to true; only an explicit env flag turns it off.
 *   - An unset MAX_ORDER_AMOUNT BLOCKS all real orders (fail-safe).
 *   - KILL_SWITCH on BLOCKS every real order path.
 *   - High-value (>= 1억 KRW) orders need explicit confirmHighValueOrder.
 *   - When the notional cannot be computed, the order is BLOCKED (fail-safe).
 *   - DRY_RUN / BLOCK never calls the raw POST and never mints a clientOrderId.
 * Changing any of these requires explicit human sign-off; an agent must stop
 * and report rather than relax a guard to make a gate pass.
 */

/** Orders at or above this KRW notional require `confirmHighValueOrder=true`. */
export const HIGH_VALUE_THRESHOLD_KRW = 100_000_000;

/** Resolved trading safety configuration (from env, see `getTradingConfig`). */
export interface TradingConfig {
  /** Defaults to true. Only an explicit `DRY_RUN=false` enables real orders. */
  dryRun: boolean;
  /** When true, every real order path is blocked. */
  killSwitch: boolean;
  /** Per-order KRW notional cap. `undefined` => no real orders (fail-safe). */
  maxOrderAmount: number | undefined;
  /** Daily loss limit (KRW). Not yet enforced here (follow-up). */
  dailyLossLimit: number | undefined;
}

/**
 * Loads the trading config from validated env. `DRY_RUN` defaults to true and
 * `KILL_SWITCH` to false (see `lib/server/env.ts`); `MAX_ORDER_AMOUNT` /
 * `DAILY_LOSS_LIMIT` are optional and stay `undefined` when unset.
 */
export function getTradingConfig(): TradingConfig {
  const env = getEnv();
  return {
    dryRun: env.DRY_RUN,
    killSwitch: env.KILL_SWITCH,
    maxOrderAmount: env.MAX_ORDER_AMOUNT,
    dailyLossLimit: env.DAILY_LOSS_LIMIT,
  };
}

export type GateDecision = "SEND" | "DRY_RUN" | "BLOCK";

export interface OrderGateContext {
  config: TradingConfig;
  /** Human confirmation for this specific order (Phase 2 manual trading). */
  confirm: boolean;
  /** Account the order would be placed on (used by the executor, not the gate). */
  accountSeq: number | string;
  /** USD->KRW rate for amount-based (US) orders. Required to value them. */
  fxRate?: number;
  /** Reference price (KRW) for MARKET quantity-based orders that lack a price. */
  referencePrice?: number;
}

export interface GateResult {
  decision: GateDecision;
  reasons: string[];
  /** Computed KRW notional, when it could be determined. */
  notionalKrw?: number;
  /** Whether the order is at/above the high-value threshold. */
  highValue: boolean;
}

/** Amount-based variant carries `orderAmount` (and never `quantity`). */
function isAmountBased(
  request: OrderCreateRequest,
): request is Extract<OrderCreateRequest, { orderAmount: string }> {
  return "orderAmount" in request;
}

/**
 * Computes the KRW notional of an order, or `undefined` when it cannot be
 * determined (in which case the gate fails safe and BLOCKS):
 *   - LIMIT quantity-based: quantity * price.
 *   - Amount-based (US, USD): orderAmount * fxRate (requires fxRate).
 *   - MARKET quantity-based: price is unknown; uses referencePrice if given,
 *     otherwise returns undefined so the caller blocks.
 */
function computeNotionalKrw(
  request: OrderCreateRequest,
  ctx: OrderGateContext,
): number | undefined {
  if (isAmountBased(request)) {
    if (ctx.fxRate === undefined || !Number.isFinite(ctx.fxRate)) {
      return undefined;
    }
    const amount = Number(request.orderAmount);
    if (!Number.isFinite(amount)) return undefined;
    return amount * ctx.fxRate;
  }

  const quantity = Number(request.quantity);
  if (!Number.isFinite(quantity)) return undefined;

  if (request.orderType === "LIMIT") {
    if (request.price === undefined) return undefined;
    const price = Number(request.price);
    if (!Number.isFinite(price)) return undefined;
    return quantity * price;
  }

  // MARKET quantity-based: no order price. Only valuable via a reference price.
  if (ctx.referencePrice === undefined || !Number.isFinite(ctx.referencePrice)) {
    return undefined;
  }
  return quantity * ctx.referencePrice;
}

/**
 * Pure §6 gate. Decides SEND / DRY_RUN / BLOCK for an order without performing
 * any I/O. Evaluation order is fail-safe: blocking conditions are checked first
 * so a blocked order can never be downgraded to a mere dry-run, and an order
 * only reaches SEND when DRY_RUN is off AND a human confirm is present AND the
 * notional is known and within the (set) limit AND kill switch is off AND any
 * high-value order is explicitly confirmed.
 */
export function evaluateOrderGate(
  request: OrderCreateRequest,
  ctx: OrderGateContext,
): GateResult {
  const reasons: string[] = [];
  const notionalKrw = computeNotionalKrw(request, ctx);
  const highValue =
    notionalKrw !== undefined && notionalKrw >= HIGH_VALUE_THRESHOLD_KRW;

  // (a) Kill switch: hard block, regardless of everything else.
  if (ctx.config.killSwitch) {
    reasons.push("kill-switch-on");
    return { decision: "BLOCK", reasons, notionalKrw, highValue };
  }

  // (b) Notional must be computable to value the order safely.
  if (notionalKrw === undefined) {
    reasons.push("notional-unknown");
    return { decision: "BLOCK", reasons, notionalKrw, highValue };
  }

  // (c) Hard limit. An unset limit blocks all real orders (fail-safe).
  if (ctx.config.maxOrderAmount === undefined) {
    reasons.push("max-order-amount-unset");
    return { decision: "BLOCK", reasons, notionalKrw, highValue };
  }
  if (notionalKrw > ctx.config.maxOrderAmount) {
    reasons.push("max-order-amount-exceeded");
    return { decision: "BLOCK", reasons, notionalKrw, highValue };
  }

  // (d) High-value orders require explicit confirmation.
  if (highValue && request.confirmHighValueOrder !== true) {
    reasons.push("high-value-not-confirmed");
    return { decision: "BLOCK", reasons, notionalKrw, highValue };
  }

  // (e) Dry-run by default, or whenever a human confirm is missing.
  if (ctx.config.dryRun) {
    reasons.push("dry-run-enabled");
    return { decision: "DRY_RUN", reasons, notionalKrw, highValue };
  }
  if (!ctx.confirm) {
    reasons.push("not-confirmed");
    return { decision: "DRY_RUN", reasons, notionalKrw, highValue };
  }

  // (f) All gates passed: a real order may be sent.
  reasons.push("gate-passed");
  return { decision: "SEND", reasons, notionalKrw, highValue };
}

// --- executor ---------------------------------------------------------------

/** Low-level raw POST, injected so the executor stays testable / I/O-free. */
export type CreateOrderRawFn = (
  params: CreateOrderRawParams,
) => Promise<OrderCreateResponse>;

/** Structured audit entry (free of secrets/PII). */
export interface AuditEntry {
  at: number;
  decision: GateDecision;
  reasons: string[];
  accountSeq: number | string;
  /** Order summary only — never auth material. */
  order: {
    symbol: string;
    side: string;
    orderType: string;
    quantity?: string;
    price?: string;
    orderAmount?: string;
    /** Preserved verbatim; the gate never mints one. */
    clientOrderId?: string;
    confirmHighValueOrder?: boolean;
  };
  notionalKrw?: number;
  highValue: boolean;
}

export type AuditLogger = (entry: AuditEntry) => void;

export interface PlaceOrderInput {
  request: OrderCreateRequest;
  /** Per-order human confirmation (Phase 2). */
  confirm: boolean;
  fxRate?: number;
  referencePrice?: number;
}

export interface PlaceOrderDeps {
  config: TradingConfig;
  createOrderRaw: CreateOrderRawFn;
  now: () => number;
  auditLog: AuditLogger;
  accountSeq: number | string;
}

export type PlaceOrderResult =
  | { status: "SENT"; response: OrderCreateResponse; notionalKrw: number }
  | { status: "DRY_RUN"; wouldSend: OrderCreateRequest; reasons: string[] }
  | { status: "BLOCKED"; request: OrderCreateRequest; reasons: string[] };

/** Builds a secret-free order summary for the audit log. */
function summarizeOrder(request: OrderCreateRequest): AuditEntry["order"] {
  const base = {
    symbol: request.symbol,
    side: request.side,
    orderType: request.orderType,
    clientOrderId: request.clientOrderId,
    confirmHighValueOrder: request.confirmHighValueOrder,
  };
  if (isAmountBased(request)) {
    return { ...base, orderAmount: request.orderAmount };
  }
  return { ...base, quantity: request.quantity, price: request.price };
}

/**
 * Order executor. Runs the §6 gate and only issues a real `POST /orders` when
 * the decision is SEND. For DRY_RUN / BLOCK it returns the would-be / rejected
 * request WITHOUT calling `createOrderRaw` and WITHOUT minting a clientOrderId
 * (any provided one is preserved verbatim, so a later real retry is not
 * misjudged as a duplicate). Every attempt — SEND, DRY_RUN, BLOCK — is recorded
 * via the injected `auditLog` with a secret-free summary.
 */
export async function placeOrder(
  input: PlaceOrderInput,
  deps: PlaceOrderDeps,
): Promise<PlaceOrderResult> {
  const ctx: OrderGateContext = {
    config: deps.config,
    confirm: input.confirm,
    accountSeq: deps.accountSeq,
    fxRate: input.fxRate,
    referencePrice: input.referencePrice,
  };

  const gate = evaluateOrderGate(input.request, ctx);

  deps.auditLog({
    at: deps.now(),
    decision: gate.decision,
    reasons: gate.reasons,
    accountSeq: deps.accountSeq,
    order: summarizeOrder(input.request),
    notionalKrw: gate.notionalKrw,
    highValue: gate.highValue,
  });

  if (gate.decision === "BLOCK") {
    return {
      status: "BLOCKED",
      request: input.request,
      reasons: gate.reasons,
    };
  }

  if (gate.decision === "DRY_RUN") {
    return {
      status: "DRY_RUN",
      wouldSend: input.request,
      reasons: gate.reasons,
    };
  }

  // SEND: the only path that touches the live API.
  const response = await deps.createOrderRaw({
    accountSeq: deps.accountSeq,
    body: input.request,
  });
  return {
    status: "SENT",
    response,
    // SEND is only reachable with a known notional (gate guarantees it).
    notionalKrw: gate.notionalKrw as number,
  };
}
