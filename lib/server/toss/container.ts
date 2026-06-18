import "server-only";
import { getEnv } from "@/lib/server/env";
import { createTokenProvider } from "@/lib/server/toss/auth";
import { createTossClient, type TossClient } from "@/lib/server/toss/client";
import { createRateLimiter } from "@/lib/server/toss/rate-limiter";
import {
  getAccounts,
  getBuyingPower,
  getCandles,
  getCommissions,
  getExchangeRate,
  getHoldings,
  getKrMarketCalendar,
  getOrder,
  getOrderbook,
  getOrders,
  getPriceLimits,
  getPrices,
  getSellableQuantity,
  getStocks,
  getStockWarnings,
  getTrades,
  getUsMarketCalendar,
  type GetBuyingPowerParams,
  type GetCandlesParams,
  type GetCommissionsParams,
  type GetExchangeRateParams,
  type GetHoldingsParams,
  type GetKrMarketCalendarParams,
  type GetOrderParams,
  type GetOrderbookParams,
  type GetOrdersParams,
  type GetPriceLimitsParams,
  type GetPricesParams,
  type GetSellableQuantityParams,
  type GetStocksParams,
  type GetStockWarningsParams,
  type GetTradesParams,
  type GetUsMarketCalendarParams,
} from "@/lib/server/toss/endpoints";
import type {
  Account,
  BuyingPowerResponse,
  CandlePageResponse,
  Commission,
  ExchangeRateResponse,
  HoldingsOverview,
  KrMarketCalendarResponse,
  Order,
  OrderbookResponse,
  PaginatedOrderResponse,
  PriceLimitResponse,
  PriceResponse,
  SellableQuantityResponse,
  StockInfo,
  StockWarning,
  Trade,
  UsMarketCalendarResponse,
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
  getOrderbook(params: GetOrderbookParams): Promise<OrderbookResponse>;
  getTrades(params: GetTradesParams): Promise<Trade[]>;
  getPriceLimits(params: GetPriceLimitsParams): Promise<PriceLimitResponse>;
  getCandles(params: GetCandlesParams): Promise<CandlePageResponse>;
  getExchangeRate(
    params: GetExchangeRateParams,
  ): Promise<ExchangeRateResponse>;
  getOrders(params: GetOrdersParams): Promise<PaginatedOrderResponse>;
  getOrder(params: GetOrderParams): Promise<Order>;
  getStocks(params: GetStocksParams): Promise<StockInfo[]>;
  getStockWarnings(params: GetStockWarningsParams): Promise<StockWarning[]>;
  getKrMarketCalendar(
    params?: GetKrMarketCalendarParams,
  ): Promise<KrMarketCalendarResponse>;
  getUsMarketCalendar(
    params?: GetUsMarketCalendarParams,
  ): Promise<UsMarketCalendarResponse>;
  getBuyingPower(params: GetBuyingPowerParams): Promise<BuyingPowerResponse>;
  getSellableQuantity(
    params: GetSellableQuantityParams,
  ): Promise<SellableQuantityResponse>;
  getCommissions(params: GetCommissionsParams): Promise<Commission[]>;
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
      getOrderbook: (params) => getOrderbook(client, params),
      getTrades: (params) => getTrades(client, params),
      getPriceLimits: (params) => getPriceLimits(client, params),
      getCandles: (params) => getCandles(client, params),
      getExchangeRate: (params) => getExchangeRate(client, params),
      getOrders: (params) => getOrders(client, params),
      getOrder: (params) => getOrder(client, params),
      getStocks: (params) => getStocks(client, params),
      getStockWarnings: (params) => getStockWarnings(client, params),
      getKrMarketCalendar: (params) => getKrMarketCalendar(client, params),
      getUsMarketCalendar: (params) => getUsMarketCalendar(client, params),
      getBuyingPower: (params) => getBuyingPower(client, params),
      getSellableQuantity: (params) => getSellableQuantity(client, params),
      getCommissions: (params) => getCommissions(client, params),
    };
  }
  return cached;
}
