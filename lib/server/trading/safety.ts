import "server-only";
import { getEnv } from "@/lib/server/env";
import { isKrwSymbol } from "@/lib/server/trading/symbol";
import type {
  CancelOrderRawParams,
  CreateOrderRawParams,
  ModifyOrderRawParams,
} from "@/lib/server/toss/endpoints";
import type {
  OrderCreateRequest,
  OrderCreateResponse,
  OrderModifyRequest,
  OrderOperationResponse,
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
  /** USD->KRW rate. Required to value any USD (non-KRX) order; without it such
   * orders fail safe and BLOCK. */
  fxRate?: number;
  /** Native-currency reference price for MARKET quantity-based orders that lack
   * a price (converted to KRW via the symbol's currency). */
  referencePrice?: number;
  /**
   * Native-currency quantity to value a modify that omits `quantity` (e.g. a US
   * price-only amendment). Supplied by the caller from the original order; when
   * absent and the modify carries no quantity, the modify gate cannot compute a
   * notional and fails safe (BLOCK). Unused by `evaluateOrderGate`.
   */
  originalQuantity?: number;
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
 * Converts a native-currency amount to KRW. KRW (KRX) symbols pass through; USD
 * symbols require `fxRate` and return `undefined` when it is missing, so the
 * caller fails safe and BLOCKS (a USD order is never under-valued as if KRW).
 */
function nativeToKrw(
  nativeAmount: number,
  symbol: string,
  fxRate: number | undefined,
): number | undefined {
  if (isKrwSymbol(symbol)) return nativeAmount;
  if (fxRate === undefined || !Number.isFinite(fxRate)) return undefined;
  return nativeAmount * fxRate;
}

/**
 * Computes the KRW notional of an order, or `undefined` when it cannot be
 * determined (in which case the gate fails safe and BLOCKS). The amount is
 * first computed in the order's native currency, then converted to KRW by the
 * symbol's currency (USD orders require `fxRate`; a missing rate => undefined):
 *   - LIMIT quantity-based: quantity * price (native).
 *   - Amount-based (US, USD): orderAmount (native USD).
 *   - MARKET quantity-based: price is unknown; uses native `referencePrice` if
 *     given, otherwise returns undefined so the caller blocks.
 */
function computeNotionalKrw(
  request: OrderCreateRequest,
  ctx: OrderGateContext,
): number | undefined {
  if (isAmountBased(request)) {
    const amount = Number(request.orderAmount);
    if (!Number.isFinite(amount)) return undefined;
    return nativeToKrw(amount, request.symbol, ctx.fxRate);
  }

  const quantity = Number(request.quantity);
  if (!Number.isFinite(quantity)) return undefined;

  if (request.orderType === "LIMIT") {
    if (request.price === undefined) return undefined;
    const price = Number(request.price);
    if (!Number.isFinite(price)) return undefined;
    return nativeToKrw(quantity * price, request.symbol, ctx.fxRate);
  }

  // MARKET quantity-based: no order price. Only valuable via a reference price.
  if (ctx.referencePrice === undefined || !Number.isFinite(ctx.referencePrice)) {
    return undefined;
  }
  return nativeToKrw(quantity * ctx.referencePrice, request.symbol, ctx.fxRate);
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

// --- modify gate ------------------------------------------------------------

/**
 * Computes the KRW notional of a *modify* request, or `undefined` when it
 * cannot be determined (so the gate fails safe and BLOCKS). The original order
 * is identified by its `symbol` (modify bodies carry none), which selects the
 * currency. The amount is computed in native currency then converted to KRW:
 *   - LIMIT: quantity * price. `quantity` may be omitted (US price-only
 *     amendment); the caller-supplied `originalQuantity` is used instead, and
 *     without either there is no way to value the order => undefined => BLOCK.
 *   - MARKET: no order price; valued via native `ctx.referencePrice`, with the
 *     same quantity fallback. A missing reference price => undefined => BLOCK.
 */
function computeModifyNotionalKrw(
  request: OrderModifyRequest,
  symbol: string,
  ctx: OrderGateContext,
): number | undefined {
  const quantity =
    request.quantity !== undefined ? Number(request.quantity) : ctx.originalQuantity;
  if (quantity === undefined || !Number.isFinite(quantity)) return undefined;

  if (request.orderType === "LIMIT") {
    if (request.price === undefined) return undefined;
    const price = Number(request.price);
    if (!Number.isFinite(price)) return undefined;
    return nativeToKrw(quantity * price, symbol, ctx.fxRate);
  }

  // MARKET: no order price. Only valuable via a reference price.
  if (ctx.referencePrice === undefined || !Number.isFinite(ctx.referencePrice)) {
    return undefined;
  }
  return nativeToKrw(quantity * ctx.referencePrice, symbol, ctx.fxRate);
}

/**
 * Pure §6 gate for an order *modify*. Mirrors `evaluateOrderGate` exactly — same
 * fail-safe ordering and the same SEND preconditions — but re-values the order
 * from the *new* modify parameters against the original order's `symbol`
 * (currency). A modify can move an order across the high-value threshold or over
 * the hard limit, so its notional is re-evaluated rather than trusted from the
 * original. When the notional cannot be computed (e.g. a price-only modify with
 * no `originalQuantity`/`referencePrice`), the modify is BLOCKED (fail-safe).
 */
export function evaluateModifyGate(
  request: OrderModifyRequest,
  symbol: string,
  ctx: OrderGateContext,
): GateResult {
  const reasons: string[] = [];
  const notionalKrw = computeModifyNotionalKrw(request, symbol, ctx);
  const highValue =
    notionalKrw !== undefined && notionalKrw >= HIGH_VALUE_THRESHOLD_KRW;

  // (a) Kill switch: hard block, regardless of everything else.
  if (ctx.config.killSwitch) {
    reasons.push("kill-switch-on");
    return { decision: "BLOCK", reasons, notionalKrw, highValue };
  }

  // (b) Notional must be computable to value the modified order safely.
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

  // (d) High-value modified orders require explicit confirmation.
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

  // (f) All gates passed: a real modify may be sent.
  reasons.push("gate-passed");
  return { decision: "SEND", reasons, notionalKrw, highValue };
}

// --- cancel gate ------------------------------------------------------------

/**
 * Pure §6 gate for an order *cancel*. A cancel reduces risk, so unlike create /
 * modify it performs NO notional / hard-limit / high-value check — there is no
 * amount to value. It only honors the two unconditional barriers:
 *   - Kill switch on => BLOCK. Per §6.4 a kill switch blocks *every* real order
 *     path (a cancel POST is still a live call), so we BLOCK conservatively.
 *     Allowing a risk-reducing cancel through during a kill is a deliberate
 *     policy exception that requires explicit human sign-off; this loop must NOT
 *     invent that exception.
 *   - DRY_RUN default / missing confirm => DRY_RUN (no real POST).
 * Otherwise => SEND.
 */
export function evaluateCancelGate(ctx: OrderGateContext): GateResult {
  const reasons: string[] = [];

  // (a) Kill switch: hard block (cancel is a live order path; see §6.4).
  if (ctx.config.killSwitch) {
    reasons.push("kill-switch-on");
    return { decision: "BLOCK", reasons, highValue: false };
  }

  // (b) Dry-run by default, or whenever a human confirm is missing.
  if (ctx.config.dryRun) {
    reasons.push("dry-run-enabled");
    return { decision: "DRY_RUN", reasons, highValue: false };
  }
  if (!ctx.confirm) {
    reasons.push("not-confirmed");
    return { decision: "DRY_RUN", reasons, highValue: false };
  }

  // (c) Cancel may be sent.
  reasons.push("gate-passed");
  return { decision: "SEND", reasons, highValue: false };
}

// --- modify / cancel executors ----------------------------------------------

/** Low-level raw POST for a modify, injected so the executor stays I/O-free. */
export type ModifyOrderRawFn = (
  params: ModifyOrderRawParams,
) => Promise<OrderOperationResponse>;

/** Low-level raw POST for a cancel, injected so the executor stays I/O-free. */
export type CancelOrderRawFn = (
  params: CancelOrderRawParams,
) => Promise<OrderOperationResponse>;

/** Structured audit entry for a modify/cancel attempt (free of secrets/PII). */
export interface OrderOpAuditEntry {
  at: number;
  /** "modify" or "cancel" — distinguishes the operation in the log. */
  op: "modify" | "cancel";
  decision: GateDecision;
  reasons: string[];
  accountSeq: number | string;
  /** The original order being modified/canceled (identifier only). */
  orderId: string;
  /** Modify summary only — never auth material. Absent for cancel. */
  modify?: {
    orderType: string;
    quantity?: string;
    price?: string;
    confirmHighValueOrder?: boolean;
  };
  notionalKrw?: number;
  highValue: boolean;
}

export type OrderOpAuditLogger = (entry: OrderOpAuditEntry) => void;

export interface ModifyOrderInput {
  orderId: string;
  /** Original order's symbol (selects currency for the re-valued notional). */
  symbol: string;
  request: OrderModifyRequest;
  /** Per-order human confirmation (Phase 2). */
  confirm: boolean;
  fxRate?: number;
  referencePrice?: number;
  /** Original order quantity, used when the modify omits `quantity`. */
  originalQuantity?: number;
}

export interface ModifyOrderDeps {
  config: TradingConfig;
  modifyOrderRaw: ModifyOrderRawFn;
  now: () => number;
  auditLog: OrderOpAuditLogger;
  accountSeq: number | string;
}

export type ModifyOrderResult =
  | {
      status: "SENT";
      response: OrderOperationResponse;
      notionalKrw: number;
    }
  | { status: "DRY_RUN"; wouldSend: OrderModifyRequest; reasons: string[] }
  | { status: "BLOCKED"; request: OrderModifyRequest; reasons: string[] };

/** Builds a secret-free modify summary for the audit log. */
function summarizeModify(request: OrderModifyRequest): OrderOpAuditEntry["modify"] {
  return {
    orderType: request.orderType,
    quantity: request.quantity,
    price: request.price,
    confirmHighValueOrder: request.confirmHighValueOrder,
  };
}

/**
 * Modify executor. Runs the §6 modify gate (which re-values the order from the
 * new parameters) and only issues a real `POST .../modify` when the decision is
 * SEND. For DRY_RUN / BLOCK it returns the would-be / rejected request WITHOUT
 * calling `modifyOrderRaw`. Every attempt — SEND, DRY_RUN, BLOCK — is recorded
 * via the injected `auditLog` with a secret-free summary. Mirrors `placeOrder`.
 */
export async function modifyOrder(
  input: ModifyOrderInput,
  deps: ModifyOrderDeps,
): Promise<ModifyOrderResult> {
  const ctx: OrderGateContext = {
    config: deps.config,
    confirm: input.confirm,
    accountSeq: deps.accountSeq,
    fxRate: input.fxRate,
    referencePrice: input.referencePrice,
    originalQuantity: input.originalQuantity,
  };

  const gate = evaluateModifyGate(input.request, input.symbol, ctx);

  deps.auditLog({
    at: deps.now(),
    op: "modify",
    decision: gate.decision,
    reasons: gate.reasons,
    accountSeq: deps.accountSeq,
    orderId: input.orderId,
    modify: summarizeModify(input.request),
    notionalKrw: gate.notionalKrw,
    highValue: gate.highValue,
  });

  if (gate.decision === "BLOCK") {
    return { status: "BLOCKED", request: input.request, reasons: gate.reasons };
  }

  if (gate.decision === "DRY_RUN") {
    return { status: "DRY_RUN", wouldSend: input.request, reasons: gate.reasons };
  }

  // SEND: the only path that touches the live API.
  const response = await deps.modifyOrderRaw({
    accountSeq: deps.accountSeq,
    orderId: input.orderId,
    body: input.request,
  });
  return {
    status: "SENT",
    response,
    // SEND is only reachable with a known notional (gate guarantees it).
    notionalKrw: gate.notionalKrw as number,
  };
}

export interface CancelOrderInput {
  orderId: string;
  /** Per-order human confirmation (Phase 2). */
  confirm: boolean;
}

export interface CancelOrderDeps {
  config: TradingConfig;
  cancelOrderRaw: CancelOrderRawFn;
  now: () => number;
  auditLog: OrderOpAuditLogger;
  accountSeq: number | string;
}

export type CancelOrderResult =
  | { status: "SENT"; response: OrderOperationResponse }
  | { status: "DRY_RUN"; orderId: string; reasons: string[] }
  | { status: "BLOCKED"; orderId: string; reasons: string[] };

/**
 * Cancel executor. Runs the §6 cancel gate (kill switch / DRY_RUN only — no
 * notional/limit check, since a cancel reduces risk) and only issues a real
 * `POST .../cancel` when the decision is SEND. For DRY_RUN / BLOCK it returns
 * without calling `cancelOrderRaw`. Every attempt is recorded via `auditLog`.
 */
export async function cancelOrder(
  input: CancelOrderInput,
  deps: CancelOrderDeps,
): Promise<CancelOrderResult> {
  const ctx: OrderGateContext = {
    config: deps.config,
    confirm: input.confirm,
    accountSeq: deps.accountSeq,
  };

  const gate = evaluateCancelGate(ctx);

  deps.auditLog({
    at: deps.now(),
    op: "cancel",
    decision: gate.decision,
    reasons: gate.reasons,
    accountSeq: deps.accountSeq,
    orderId: input.orderId,
    highValue: gate.highValue,
  });

  if (gate.decision === "BLOCK") {
    return { status: "BLOCKED", orderId: input.orderId, reasons: gate.reasons };
  }

  if (gate.decision === "DRY_RUN") {
    return { status: "DRY_RUN", orderId: input.orderId, reasons: gate.reasons };
  }

  // SEND: the only path that touches the live API.
  const response = await deps.cancelOrderRaw({
    accountSeq: deps.accountSeq,
    orderId: input.orderId,
  });
  return { status: "SENT", response };
}
