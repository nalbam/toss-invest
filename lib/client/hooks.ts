"use client";

import useSWR, { type SWRConfiguration } from "swr";
import type {
  Account,
  CandlePageResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  OrderbookResponse,
  OrderCreateBody,
  OrderPlaceResult,
  PaginatedOrderResponse,
  PriceLimitResponse,
  PriceResponse,
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
}

const sharedConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  shouldRetryOnError: false,
};

/** Loads the list of accounts. */
export function useAccounts(): QueryResult<Account[]> {
  const { data, error, isLoading } = useSWR<Account[], ApiClientError>(
    "/api/accounts",
    fetcher,
    sharedConfig,
  );
  return { data, error, isLoading };
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
  const { data, error, isLoading } = useSWR<HoldingsOverview, ApiClientError>(
    key,
    fetcher,
    sharedConfig,
  );
  return { data, error, isLoading: isLoading && key !== null };
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
  const { data, error, isLoading } = useSWR<
    PaginatedOrderResponse,
    ApiClientError
  >(key, fetcher, sharedConfig);
  return { data, error, isLoading: isLoading && key !== null };
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
  const { data, error, isLoading } = useSWR<PriceResponse[], ApiClientError>(
    key,
    fetcher,
    sharedConfig,
  );
  return { data, error, isLoading: isLoading && key !== null };
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
  const { data, error, isLoading } = useSWR<
    PriceLimitResponse,
    ApiClientError
  >(key, fetcher, sharedConfig);
  return { data, error, isLoading: isLoading && key !== null };
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
  const { data, error, isLoading } = useSWR<OrderbookResponse, ApiClientError>(
    key,
    fetcher,
    sharedConfig,
  );
  return { data, error, isLoading: isLoading && key !== null };
}

/**
 * Loads a page of OHLCV candles for a symbol at the given interval. The request
 * is paused (key is `null`) until a symbol is known.
 */
export function useCandles(
  symbol: string | undefined,
  interval: "1m" | "1d",
): QueryResult<CandlePageResponse> {
  const key =
    symbol === undefined
      ? null
      : `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;
  const { data, error, isLoading } = useSWR<
    CandlePageResponse,
    ApiClientError
  >(key, fetcher, sharedConfig);
  return { data, error, isLoading: isLoading && key !== null };
}

/** Loads the exchange rate for a base/quote currency pair. */
export function useExchangeRate(
  baseCurrency: string,
  quoteCurrency: string,
): QueryResult<ExchangeRateResponse> {
  const key = `/api/exchange-rate?baseCurrency=${encodeURIComponent(
    baseCurrency,
  )}&quoteCurrency=${encodeURIComponent(quoteCurrency)}`;
  const { data, error, isLoading } = useSWR<
    ExchangeRateResponse,
    ApiClientError
  >(key, fetcher, sharedConfig);
  return { data, error, isLoading };
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

  return (payload as SuccessEnvelope<OrderPlaceResult>).data;
}
