"use client";

import useSWR, { type SWRConfiguration } from "swr";
import type {
  Account,
  ExchangeRateResponse,
  HoldingsOverview,
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
