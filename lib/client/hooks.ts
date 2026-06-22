"use client";

import useSWR, { type SWRConfiguration } from "swr";
import type { TossCandleInterval } from "@/lib/client/candles";
import { POLLING_INTERVAL_MS } from "@/lib/client/polling";
import type {
  Account,
  BuyingPower,
  CancelOrderResult,
  CandlePageResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  ModifyOrderResult,
  OrderbookResponse,
  OrderCreateBody,
  OrderModifyBody,
  OrderPlaceResult,
  PaginatedOrderResponse,
  PriceLimitResponse,
  PriceResponse,
  SellableQuantity,
  Trade,
} from "@/lib/client/types";

/**
 * SWR data hooks for the browser. They only ever call the app's own `/api/*`
 * routes (never the upstream Toss API directly), so no secrets reach the
 * client bundle. Each hook returns the parsed payload, a loading flag, and an
 * `ApiClientError` when the response carries the `{ error }` envelope.
 */

/** Error thrown when an `/api/*` route responds with the `{ error }` envelope. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
  }) {
    super(args.message);
    this.name = "ApiClientError";
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId;
  }
}

interface SuccessEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string };
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "object"
  );
}

/**
 * Fetches an `/api/*` route and unwraps the `{ data }` envelope. Any `{ error }`
 * body (or non-JSON failure) is converted into a thrown `ApiClientError`, which
 * SWR surfaces through its `error` field.
 */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unreadable response.",
      status: res.status,
    });
  }

  if (!res.ok || isErrorEnvelope(body)) {
    if (isErrorEnvelope(body)) {
      throw new ApiClientError({
        code: body.error.code,
        message: body.error.message,
        status: res.status,
        requestId: body.error.requestId,
      });
    }
    throw new ApiClientError({
      code: "unexpected-error",
      message: `Request failed with status ${res.status}.`,
      status: res.status,
    });
  }

  return (body as SuccessEnvelope<T>).data;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: ApiClientError | undefined;
  isLoading: boolean;
  isRefreshing?: boolean;
}

const sharedConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  shouldRetryOnError: false,
};

const accountConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.account,
};

const holdingsConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.holdings,
};

const ordersConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.orders,
};

const pricesConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.prices,
  dedupingInterval: POLLING_INTERVAL_MS.prices,
};

const priceLimitsConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.priceLimits,
};

const orderbookConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.orderbook,
  dedupingInterval: POLLING_INTERVAL_MS.orderbook,
};

// Recent trades move as fast as the orderbook, so they share its cadence.
const tradesConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.orderbook,
  dedupingInterval: POLLING_INTERVAL_MS.orderbook,
};

const candlesConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.candles,
  dedupingInterval: POLLING_INTERVAL_MS.candles,
};

const exchangeRateConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.exchangeRate,
};

const cashBalanceConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.cashBalance,
};

/** Loads the list of accounts. */
export function useAccounts(): QueryResult<Account[]> {
  const { data, error, isLoading, isValidating } = useSWR<
    Account[],
    ApiClientError
  >(
    "/api/accounts",
    fetcher,
    accountConfig,
  );
  return { data, error, isLoading, isRefreshing: isValidating && !isLoading };
}

/**
 * Loads the holdings overview for an account. The request is paused (key is
 * `null`) until an `accountSeq` is known, so the first account can be resolved
 * before fetching.
 */
export function useHoldings(
  accountSeq: number | undefined,
): QueryResult<HoldingsOverview> {
  const key =
    accountSeq === undefined
      ? null
      : `/api/holdings?accountSeq=${accountSeq}`;
  const { data, error, isLoading, isValidating } = useSWR<
    HoldingsOverview,
    ApiClientError
  >(key, fetcher, holdingsConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Loads the order list for an account. Defaults to `status=OPEN` because the
 * upstream API does not yet support `CLOSED` (it returns `closed-not-supported`).
 * The request is paused (key is `null`) until an `accountSeq` is known.
 */
export function useOrders(
  accountSeq: number | undefined,
  options: { status?: "OPEN"; symbol?: string } = {},
): QueryResult<PaginatedOrderResponse> {
  const status = options.status ?? "OPEN";
  let key: string | null = null;
  if (accountSeq !== undefined) {
    const params = new URLSearchParams({
      accountSeq: String(accountSeq),
      status,
    });
    if (options.symbol !== undefined) {
      params.set("symbol", options.symbol);
    }
    key = `/api/orders?${params.toString()}`;
  }
  const { data, error, isLoading, isValidating } = useSWR<
    PaginatedOrderResponse,
    ApiClientError
  >(key, fetcher, ordersConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Loads the latest prices for one or more symbols. The request is paused (key
 * is `null`) until at least one symbol is provided, so the caller can resolve a
 * default symbol before fetching.
 */
export function usePrices(symbols: string[]): QueryResult<PriceResponse[]> {
  const key =
    symbols.length === 0
      ? null
      : `/api/prices?symbols=${encodeURIComponent(symbols.join(","))}`;
  const { data, error, isLoading, isValidating } = useSWR<
    PriceResponse[],
    ApiClientError
  >(key, fetcher, pricesConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Loads the daily upper/lower price limits for a symbol. The request is paused
 * (key is `null`) until a symbol is known. For markets without limits (e.g.
 * US) the response carries `null` limit prices.
 */
export function usePriceLimits(
  symbol: string | undefined,
): QueryResult<PriceLimitResponse> {
  const key =
    symbol === undefined
      ? null
      : `/api/price-limits?symbol=${encodeURIComponent(symbol)}`;
  const { data, error, isLoading, isValidating } = useSWR<
    PriceLimitResponse,
    ApiClientError
  >(key, fetcher, priceLimitsConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Loads the orderbook (asks/bids) for a symbol. The request is paused (key is
 * `null`) until a symbol is known.
 */
export function useOrderbook(
  symbol: string | undefined,
): QueryResult<OrderbookResponse> {
  const key =
    symbol === undefined
      ? null
      : `/api/orderbook?symbol=${encodeURIComponent(symbol)}`;
  const { data, error, isLoading, isValidating } = useSWR<
    OrderbookResponse,
    ApiClientError
  >(key, fetcher, orderbookConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Loads the most recent trades (executions) for a symbol. The request is paused
 * (key is `null`) until a symbol is known.
 */
export function useTrades(symbol: string | undefined): QueryResult<Trade[]> {
  const key =
    symbol === undefined
      ? null
      : `/api/trades?symbol=${encodeURIComponent(symbol)}`;
  const { data, error, isLoading, isValidating } = useSWR<Trade[], ApiClientError>(
    key,
    fetcher,
    tradesConfig,
  );
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Loads a page of OHLCV candles for a symbol at the given interval. The request
 * is paused (key is `null`) until a symbol is known.
 */
export function useCandles(
  symbol: string | undefined,
  interval: TossCandleInterval,
): QueryResult<CandlePageResponse> {
  const key =
    symbol === undefined
      ? null
      : `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;
  const { data, error, isLoading, isValidating } = useSWR<
    CandlePageResponse,
    ApiClientError
  >(key, fetcher, candlesConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/** Loads the exchange rate for a base/quote currency pair. */
export function useExchangeRate(
  baseCurrency: string,
  quoteCurrency: string,
): QueryResult<ExchangeRateResponse> {
  const key = `/api/exchange-rate?baseCurrency=${encodeURIComponent(
    baseCurrency,
  )}&quoteCurrency=${encodeURIComponent(quoteCurrency)}`;
  const { data, error, isLoading, isValidating } = useSWR<
    ExchangeRateResponse,
    ApiClientError
  >(key, fetcher, exchangeRateConfig);
  return { data, error, isLoading, isRefreshing: isValidating && !isLoading };
}

/**
 * Loads the cash buying power for one currency of an account. There is no
 * dedicated deposit endpoint, so cash buying power stands in for the cash
 * balance. The request is paused (key is `null`) until an `accountSeq` is known.
 */
function useCashBalance(
  accountSeq: number | undefined,
  currency: "KRW" | "USD",
): QueryResult<BuyingPower> {
  const key =
    accountSeq === undefined
      ? null
      : `/api/buying-power?accountSeq=${accountSeq}&currency=${currency}`;
  const { data, error, isLoading, isValidating } = useSWR<
    BuyingPower,
    ApiClientError
  >(key, fetcher, cashBalanceConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

export interface CashBalances {
  krw?: string;
  usd?: string;
  isLoading: boolean;
  isRefreshing?: boolean;
  error: ApiClientError | undefined;
}

/**
 * Loads an account's KRW and USD cash balances as two independent requests, so
 * one currency failing leaves the other (and the rest of the screen) usable —
 * the failed side is simply left `undefined`. Paused until `accountSeq` is known.
 */
export function useCashBalances(accountSeq: number | undefined): CashBalances {
  const krw = useCashBalance(accountSeq, "KRW");
  const usd = useCashBalance(accountSeq, "USD");
  return {
    krw: krw.data?.cashBuyingPower,
    usd: usd.data?.cashBuyingPower,
    isLoading: krw.isLoading || usd.isLoading,
    isRefreshing: Boolean(krw.isRefreshing || usd.isRefreshing),
    error: krw.error ?? usd.error,
  };
}

/**
 * Loads the sellable (available-to-sell) quantity for a symbol on an account.
 * The request is paused (key is `null`) until both an `accountSeq` and a symbol
 * are known. Shares the cash-balance polling cadence since both inform order
 * capacity. Used by the quick-order form to fill the SELL quantity in one tap.
 */
export function useSellableQuantity(
  accountSeq: number | undefined,
  symbol: string | undefined,
): QueryResult<SellableQuantity> {
  const key =
    accountSeq === undefined || symbol === undefined
      ? null
      : `/api/sellable-quantity?accountSeq=${accountSeq}&symbol=${encodeURIComponent(
          symbol,
        )}`;
  const { data, error, isLoading, isValidating } = useSWR<
    SellableQuantity,
    ApiClientError
  >(key, fetcher, cashBalanceConfig);
  return {
    data,
    error,
    isLoading: isLoading && key !== null,
    isRefreshing: isValidating && !isLoading && key !== null,
  };
}

/**
 * Submits an order to `POST /api/orders` for the given account. Returns the
 * parsed `{ status }` result (DRY_RUN / SENT / BLOCKED) on success and throws an
 * `ApiClientError` when the route responds with the `{ error }` envelope (or a
 * non-JSON failure). The §6 safety gate is the source of truth: `body.confirm`
 * is forwarded verbatim, so an unchecked confirm yields a DRY_RUN preview.
 */
export async function submitOrder(
  accountSeq: number | undefined,
  body: OrderCreateBody,
): Promise<OrderPlaceResult> {
  const url =
    accountSeq === undefined
      ? "/api/orders"
      : `/api/orders?accountSeq=${accountSeq}`;
  return postOrderJson<OrderPlaceResult>(url, body);
}

/**
 * POSTs an order-operation body to an `/api/orders*` route and unwraps the
 * `{ data }` envelope. Any `{ error }` body (or non-JSON failure) is converted
 * into a thrown `ApiClientError`. Shared by `submitOrder`, `modifyOrder`, and
 * `cancelOrder`; the §6 safety gate stays the source of truth, so `body.confirm`
 * is forwarded verbatim and an unchecked confirm yields a DRY_RUN preview.
 */
async function postOrderJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unreadable response.",
      status: res.status,
    });
  }

  if (!res.ok || isErrorEnvelope(payload)) {
    if (isErrorEnvelope(payload)) {
      throw new ApiClientError({
        code: payload.error.code,
        message: payload.error.message,
        status: res.status,
        requestId: payload.error.requestId,
      });
    }
    throw new ApiClientError({
      code: "unexpected-error",
      message: `Request failed with status ${res.status}.`,
      status: res.status,
    });
  }

  return (payload as SuccessEnvelope<T>).data;
}

/**
 * Modifies an existing order via `POST /api/orders/{orderId}/modify`. `confirm`
 * is forwarded verbatim (never forced to `true`), so an unchecked confirm comes
 * back as a DRY_RUN preview from the §6 gate. Returns the parsed `{ status }`
 * result and throws an `ApiClientError` on the `{ error }` envelope.
 */
export async function modifyOrder(
  accountSeq: number | undefined,
  orderId: string,
  body: OrderModifyBody,
  confirm: boolean,
): Promise<ModifyOrderResult> {
  const url =
    accountSeq === undefined
      ? `/api/orders/${encodeURIComponent(orderId)}/modify`
      : `/api/orders/${encodeURIComponent(orderId)}/modify?accountSeq=${accountSeq}`;
  return postOrderJson<ModifyOrderResult>(url, { ...body, confirm });
}

/**
 * Cancels an existing order via `POST /api/orders/{orderId}/cancel`. `confirm`
 * is forwarded verbatim (never forced to `true`), so an unchecked confirm comes
 * back as a DRY_RUN preview from the §6 gate. Returns the parsed `{ status }`
 * result and throws an `ApiClientError` on the `{ error }` envelope.
 */
export async function cancelOrder(
  accountSeq: number | undefined,
  orderId: string,
  confirm: boolean,
): Promise<CancelOrderResult> {
  const url =
    accountSeq === undefined
      ? `/api/orders/${encodeURIComponent(orderId)}/cancel`
      : `/api/orders/${encodeURIComponent(orderId)}/cancel?accountSeq=${accountSeq}`;
  return postOrderJson<CancelOrderResult>(url, { confirm });
}
