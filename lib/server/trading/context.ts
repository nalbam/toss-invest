import "server-only";
import type { ServerTossClient } from "@/lib/server/toss/container";
import type {
  Order,
  OrderCreateRequest,
  OrderModifyRequest,
} from "@/lib/server/toss/schemas";

/**
 * KRX symbols are 6-digit numeric (e.g. `005930`) and trade in KRW; everything
 * else (US tickers like `AAPL`) trades in USD. Mirrors the API's symbol rule and
 * the same predicate used by the §6 gate in `safety.ts` (kept in sync here since
 * that helper is intentionally not exported).
 */
function isKrwSymbol(symbol: string): boolean {
  return /^\d{6}$/.test(symbol);
}

/** A LIMIT order carries its own price, so no reference price is needed. */
function needsReferencePrice(orderType: string): boolean {
  return orderType !== "LIMIT";
}

/**
 * Gate context inputs the route forwards to the §6 executors. Every field is
 * optional: when a lookup cannot supply a value it is left `undefined` so the
 * gate fails safe and BLOCKS rather than valuing the order on a guess. The
 * route MUST NOT substitute its own value to push a blocked order through.
 */
export interface OrderGateInputs {
  fxRate?: number;
  referencePrice?: number;
}

/**
 * Resolves the USD->KRW `fxRate`, or `undefined` when the rate cannot be read
 * or is not finite (so the caller fails safe). KRW symbols never need an fx
 * rate, so this returns `undefined` for them too (the gate treats KRW notionals
 * as native and ignores `fxRate`).
 */
async function resolveFxRate(
  client: ServerTossClient,
  symbol: string,
): Promise<number | undefined> {
  if (isKrwSymbol(symbol)) return undefined;
  try {
    const fx = await client.getExchangeRate({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
    });
    const rate = Number(fx.rate);
    return Number.isFinite(rate) ? rate : undefined;
  } catch {
    // Lookup failure => leave undefined so the gate BLOCKs a USD order rather
    // than under-valuing it. Never default to a guessed rate.
    return undefined;
  }
}

/**
 * Resolves the native-currency reference price for a MARKET order (which has no
 * order price), or `undefined` when the price cannot be read. The returned price
 * is in the symbol's own currency (KRW for KRX, USD for US); the gate converts
 * it to KRW via `fxRate` when the symbol is USD.
 */
async function resolveReferencePrice(
  client: ServerTossClient,
  symbol: string,
): Promise<number | undefined> {
  try {
    const prices = await client.getPrices({ symbols: [symbol] });
    const match = prices.find((p) => p.symbol === symbol) ?? prices[0];
    if (!match) return undefined;
    const price = Number(match.lastPrice);
    return Number.isFinite(price) ? price : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Assembles the gate context for a *create*: the USD->KRW `fxRate` for non-KRW
 * symbols and, for MARKET orders that lack a price, a native `referencePrice`.
 * Any lookup that fails or yields a non-finite value is left `undefined`, which
 * makes the §6 gate BLOCK the order (fail-safe). The route passes these through
 * verbatim and never fills a missing value to force a SEND.
 */
export async function assembleCreateContext(
  client: ServerTossClient,
  request: OrderCreateRequest,
): Promise<OrderGateInputs> {
  const fxRate = await resolveFxRate(client, request.symbol);
  // Amount-based orders are valued from `orderAmount` directly; quantity-based
  // MARKET orders are the only ones that need a reference price.
  const isAmountBased = "orderAmount" in request;
  const referencePrice =
    !isAmountBased && needsReferencePrice(request.orderType)
      ? await resolveReferencePrice(client, request.symbol)
      : undefined;
  return { fxRate, referencePrice };
}

/**
 * Original-order facts needed to re-value a *modify* at the gate: the order's
 * `symbol` (selects currency — modify bodies carry none) and its
 * `originalQuantity` (used when the modify omits `quantity`, e.g. a US price-only
 * amendment). Looked up via `getOrder`.
 */
export interface ModifyOriginalContext {
  symbol: string;
  originalQuantity?: number;
  fxRate?: number;
  referencePrice?: number;
}

/**
 * Assembles the gate context for a *modify*. Loads the original order to learn
 * its `symbol` and `originalQuantity`, then resolves `fxRate` (for USD symbols)
 * and, when the modify becomes a MARKET order, a native `referencePrice`. A
 * non-finite original quantity is dropped to `undefined` so the gate fails safe
 * when the modify also omits `quantity`. The route forwards these verbatim.
 */
export async function assembleModifyContext(
  client: ServerTossClient,
  accountSeq: number | string,
  orderId: string,
  request: OrderModifyRequest,
): Promise<ModifyOriginalContext> {
  const order: Order = await client.getOrder({ accountSeq, orderId });
  const quantity = Number(order.quantity);
  const originalQuantity = Number.isFinite(quantity) ? quantity : undefined;
  const fxRate = await resolveFxRate(client, order.symbol);
  const referencePrice = needsReferencePrice(request.orderType)
    ? await resolveReferencePrice(client, order.symbol)
    : undefined;
  return { symbol: order.symbol, originalQuantity, fxRate, referencePrice };
}
