"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { isErrorEnvelope } from "@/lib/client/envelope";
import type { TossCandleInterval } from "@/lib/client/candles";
import type { MarketAdvisorHistoryEvent } from "@/lib/client/market-advisor";
import { POLLING_INTERVAL_MS } from "@/lib/client/polling";
import type {
  Account,
  BuyingPower,
  CancelOrderResult,
  CandlePageResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  ModifyOrderResult,
  NewsArticle,
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

/**
 * Unwraps a JSON `{ data }` envelope from an `/api/*` response. Any `{ error }`
 * body (or a non-JSON failure) is converted into a thrown `ApiClientError`,
 * which SWR surfaces through its `error` field. Shared by `fetcher` (GET) and
 * `postOrderJson` (order POSTs).
 */
async function unwrapJson<T>(res: Response): Promise<T> {
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

async function fetcher<T>(url: string): Promise<T> {
  return unwrapJson<T>(await fetch(url));
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

const marketAdvisorHistoryConfig: SWRConfiguration = {
  ...sharedConfig,
  refreshInterval: POLLING_INTERVAL_MS.candles,
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
 * Loads the order list for an account. `status` selects the lifecycle group:
 * `OPEN` (default) returns pending orders; `CLOSED` returns terminal orders
 * (FILLED/CANCELED/REJECTED/REPLACED, most recent first). The request is paused
 * (key is `null`) until an `accountSeq` is known.
 */
export function useOrders(
  accountSeq: number | undefined,
  options: { status?: "OPEN" | "CLOSED"; symbol?: string } = {},
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
 * Loads recent news for a symbol. The query uses the same key the market advisor
 * uses (`name ?? symbol`), so the server-side 10-minute cache is shared — viewing
 * a symbol and running the advisor on it cost one upstream search total. The
 * request is paused (key is `null`) until a symbol is known; the list is empty
 * when news is unconfigured or a search fails (the route fails open).
 */
export function useNews(
  symbol: string | undefined,
  name: string | undefined,
): QueryResult<NewsArticle[]> {
  let key: string | null = null;
  if (symbol !== undefined) {
    const params = new URLSearchParams({ symbol });
    if (name !== undefined) {
      params.set("name", name);
    }
    key = `/api/news?${params.toString()}`;
  }
  const { data, error, isLoading, isValidating } = useSWR<
    NewsArticle[],
    ApiClientError
  >(key, fetcher, sharedConfig);
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

/**
 * One-off fetch of a cache-backed candle page (not SWR — used for on-demand
 * pagination/backfill rather than polling). `before` is the time-descending
 * cursor (a candle timestamp); omit it for the latest page. Throws
 * `ApiClientError` on failure.
 */
export function fetchCandlePage(
  symbol: string,
  interval: TossCandleInterval,
  options: { before?: string; count?: number } = {},
): Promise<CandlePageResponse> {
  const params = new URLSearchParams({
    symbol,
    interval,
    count: String(options.count ?? 200),
  });
  if (options.before !== undefined) {
    params.set("before", options.before);
  }
  return fetcher<CandlePageResponse>(`/api/candles?${params.toString()}`);
}

/** Older-page fetch for the chart's "load earlier" scroll pagination. */
export function fetchOlderCandles(
  symbol: string,
  interval: TossCandleInterval,
  before: string,
  count = 200,
): Promise<CandlePageResponse> {
  return fetchCandlePage(symbol, interval, { before, count });
}

/** SWR key for a symbol/interval advice history; exported so callers can revalidate it. */
export function marketAdvisorHistoryKey(symbol: string, interval: string): string {
  return `/api/market-advisor/history?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${encodeURIComponent(interval)}`;
}

export function useMarketAdvisorHistory(
  symbol: string | undefined,
  interval: string,
): QueryResult<{ events: MarketAdvisorHistoryEvent[] }> {
  const key =
    symbol === undefined ? null : marketAdvisorHistoryKey(symbol, interval);
  const { data, error, isLoading, isValidating } = useSWR<
    { events: MarketAdvisorHistoryEvent[] },
    ApiClientError
  >(key, fetcher, marketAdvisorHistoryConfig);
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
  return unwrapJson<T>(res);
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
