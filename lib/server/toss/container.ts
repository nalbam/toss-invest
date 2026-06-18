import "server-only";
import { getEnv } from "@/lib/server/env";
import { createTokenProvider } from "@/lib/server/toss/auth";
import { createTossClient, type TossClient } from "@/lib/server/toss/client";
import { createRateLimiter } from "@/lib/server/toss/rate-limiter";
import {
  getAccounts,
  getExchangeRate,
  getHoldings,
  getPrices,
  type GetExchangeRateParams,
  type GetHoldingsParams,
  type GetPricesParams,
} from "@/lib/server/toss/endpoints";
import type {
  Account,
  ExchangeRateResponse,
  HoldingsOverview,
  PriceResponse,
} from "@/lib/server/toss/schemas";

/**
 * Endpoint facade exposed to Route Handlers. Each method binds the live client
 * so callers never touch the raw client or its dependencies. Keeping this
 * surface narrow makes the whole boundary trivial to `vi.mock` in route tests.
 */
export interface ServerTossClient {
  getAccounts(): Promise<Account[]>;
  getHoldings(params: GetHoldingsParams): Promise<HoldingsOverview>;
  getPrices(params: GetPricesParams): Promise<PriceResponse[]>;
  getExchangeRate(
    params: GetExchangeRateParams,
  ): Promise<ExchangeRateResponse>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function buildClient(): TossClient {
  const env = getEnv();
  const fetchFn = (url: string, init: RequestInit) => fetch(url, init);
  const now = () => Date.now();
  const tokenProvider = createTokenProvider({
    apiBase: env.TOSS_API_BASE,
    clientId: env.TOSS_CLIENT_ID,
    clientSecret: env.TOSS_CLIENT_SECRET,
    fetchFn,
    now,
  });
  const rateLimiter = createRateLimiter({ now, sleep });
  return createTossClient({
    tokenProvider,
    fetchFn,
    now,
    sleep,
    rateLimiter,
    baseUrl: env.TOSS_API_BASE,
  });
}

let cached: ServerTossClient | null = null;

/**
 * Returns the process-wide Toss client facade, assembling real dependencies
 * (global `fetch`, `Date.now` clock, `setTimeout` sleep, the live rate limiter,
 * and a token provider seeded from validated env) on first use.
 */
export function getServerTossClient(): ServerTossClient {
  if (cached === null) {
    const client = buildClient();
    cached = {
      getAccounts: () => getAccounts(client),
      getHoldings: (params) => getHoldings(client, params),
      getPrices: (params) => getPrices(client, params),
      getExchangeRate: (params) => getExchangeRate(client, params),
    };
  }
  return cached;
}
