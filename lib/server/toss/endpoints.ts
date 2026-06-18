import "server-only";
import type { TossClient } from "@/lib/server/toss/client";
import {
  accountsResultSchema,
  buyingPowerResponseSchema,
  candlePageResponseSchema,
  commissionsResultSchema,
  exchangeRateResponseSchema,
  holdingsOverviewSchema,
  krMarketCalendarResponseSchema,
  orderbookResponseSchema,
  orderCreateResponseSchema,
  orderOperationResponseSchema,
  orderSchema,
  paginatedOrderResponseSchema,
  priceLimitResponseSchema,
  pricesResultSchema,
  sellableQuantityResponseSchema,
  stocksResultSchema,
  stockWarningsResultSchema,
  tradesResultSchema,
  usMarketCalendarResponseSchema,
  type Account,
  type BuyingPowerResponse,
  type CandlePageResponse,
  type Commission,
  type ExchangeRateResponse,
  type HoldingsOverview,
  type KrMarketCalendarResponse,
  type Order,
  type OrderbookResponse,
  type OrderCreateRequest,
  type OrderCreateResponse,
  type OrderModifyRequest,
  type OrderOperationResponse,
  type PaginatedOrderResponse,
  type PriceLimitResponse,
  type PriceResponse,
  type SellableQuantityResponse,
  type StockInfo,
  type StockWarning,
  type Trade,
  type UsMarketCalendarResponse,
} from "@/lib/server/toss/schemas";

/** `GET /api/v1/accounts` — no params, no account header. */
export function getAccounts(client: TossClient): Promise<Account[]> {
  return client.get("/api/v1/accounts", accountsResultSchema, {
    group: "ACCOUNT",
  });
}

export interface GetHoldingsParams {
  accountSeq: number | string;
  symbol?: string;
}

/** `GET /api/v1/holdings` — requires `X-Tossinvest-Account`, optional `symbol`. */
export function getHoldings(
  client: TossClient,
  params: GetHoldingsParams,
): Promise<HoldingsOverview> {
  return client.get("/api/v1/holdings", holdingsOverviewSchema, {
    group: "ASSET",
    accountSeq: params.accountSeq,
    query: { symbol: params.symbol },
  });
}

export interface GetPricesParams {
  symbols: string[];
}

/** `GET /api/v1/prices` — `symbols` query is comma-joined. */
export function getPrices(
  client: TossClient,
  params: GetPricesParams,
): Promise<PriceResponse[]> {
  return client.get("/api/v1/prices", pricesResultSchema, {
    group: "MARKET_DATA",
    query: { symbols: params.symbols.join(",") },
  });
}

export interface GetOrderbookParams {
  symbol: string;
}

/** `GET /api/v1/orderbook` — `symbol` query, no account header. */
export function getOrderbook(
  client: TossClient,
  params: GetOrderbookParams,
): Promise<OrderbookResponse> {
  return client.get("/api/v1/orderbook", orderbookResponseSchema, {
    group: "MARKET_DATA",
    query: { symbol: params.symbol },
  });
}

export interface GetTradesParams {
  symbol: string;
  count?: number;
}

/** `GET /api/v1/trades` — `symbol` query, optional `count`, no account header. */
export function getTrades(
  client: TossClient,
  params: GetTradesParams,
): Promise<Trade[]> {
  return client.get("/api/v1/trades", tradesResultSchema, {
    group: "MARKET_DATA",
    query: {
      symbol: params.symbol,
      count: params.count === undefined ? undefined : String(params.count),
    },
  });
}

export interface GetPriceLimitsParams {
  symbol: string;
}

/** `GET /api/v1/price-limits` — `symbol` query, no account header. */
export function getPriceLimits(
  client: TossClient,
  params: GetPriceLimitsParams,
): Promise<PriceLimitResponse> {
  return client.get("/api/v1/price-limits", priceLimitResponseSchema, {
    group: "MARKET_DATA",
    query: { symbol: params.symbol },
  });
}

export interface GetCandlesParams {
  symbol: string;
  interval: "1m" | "1d";
  count?: number;
  before?: string;
  adjusted?: boolean;
}

/**
 * `GET /api/v1/candles` — requires `symbol` and `interval`; optional `count`,
 * `before` (cursor), and `adjusted`. Uses the MARKET_DATA_CHART (5 TPS) budget.
 * Returns a page (`candles`, `nextBefore`) for time-descending pagination.
 */
export function getCandles(
  client: TossClient,
  params: GetCandlesParams,
): Promise<CandlePageResponse> {
  return client.get("/api/v1/candles", candlePageResponseSchema, {
    group: "MARKET_DATA_CHART",
    query: {
      symbol: params.symbol,
      interval: params.interval,
      count: params.count === undefined ? undefined : String(params.count),
      before: params.before,
      adjusted:
        params.adjusted === undefined ? undefined : String(params.adjusted),
    },
  });
}

export interface GetExchangeRateParams {
  baseCurrency: string;
  quoteCurrency: string;
  dateTime?: string;
}

/** `GET /api/v1/exchange-rate` — base/quote currency required, optional dateTime. */
export function getExchangeRate(
  client: TossClient,
  params: GetExchangeRateParams,
): Promise<ExchangeRateResponse> {
  return client.get("/api/v1/exchange-rate", exchangeRateResponseSchema, {
    group: "MARKET_INFO",
    query: {
      baseCurrency: params.baseCurrency,
      quoteCurrency: params.quoteCurrency,
      dateTime: params.dateTime,
    },
  });
}

export interface GetOrdersParams {
  accountSeq: number | string;
  /** Required by the API. `CLOSED` currently yields 400 `closed-not-supported`. */
  status: string;
  symbol?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/**
 * `GET /api/v1/orders` — requires `X-Tossinvest-Account` and a `status` query.
 * Returns a paginated list (`orders`, `nextCursor`, `hasNext`).
 */
export function getOrders(
  client: TossClient,
  params: GetOrdersParams,
): Promise<PaginatedOrderResponse> {
  return client.get("/api/v1/orders", paginatedOrderResponseSchema, {
    group: "ORDER_HISTORY",
    accountSeq: params.accountSeq,
    query: {
      status: params.status,
      symbol: params.symbol,
      from: params.from,
      to: params.to,
      cursor: params.cursor,
      limit: params.limit === undefined ? undefined : String(params.limit),
    },
  });
}

export interface GetOrderParams {
  accountSeq: number | string;
  orderId: string;
}

/** `GET /api/v1/orders/{orderId}` — requires `X-Tossinvest-Account`. */
export function getOrder(
  client: TossClient,
  params: GetOrderParams,
): Promise<Order> {
  return client.get(
    `/api/v1/orders/${encodeURIComponent(params.orderId)}`,
    orderSchema,
    {
      group: "ORDER_HISTORY",
      accountSeq: params.accountSeq,
    },
  );
}

export interface CreateOrderRawParams {
  accountSeq: number | string;
  body: OrderCreateRequest;
}

/**
 * ⚠️ LOW-LEVEL, UNGATED real-money call: `POST /api/v1/orders` (ORDER group,
 * account header). This sends an actual order to the live API.
 *
 * DO NOT call this directly from routes, UI, or other endpoints. It MUST only
 * be reached through `lib/server/trading` (`placeOrder`), which enforces the
 * §6 safety gate (DRY_RUN default / kill switch / hard limits / high-value /
 * idempotency / audit log) before any real POST. Bypassing the gate would
 * defeat every trading safeguard.
 */
export function createOrderRaw(
  client: TossClient,
  params: CreateOrderRawParams,
): Promise<OrderCreateResponse> {
  return client.post("/api/v1/orders", orderCreateResponseSchema, {
    group: "ORDER",
    accountSeq: params.accountSeq,
    body: params.body,
  });
}

export interface ModifyOrderRawParams {
  accountSeq: number | string;
  orderId: string;
  body: OrderModifyRequest;
}

/**
 * ⚠️ LOW-LEVEL, UNGATED real-money call: `POST /api/v1/orders/{orderId}/modify`
 * (ORDER group, account header). This amends an actual live order.
 *
 * DO NOT call this directly from routes, UI, or other endpoints. It MUST only
 * be reached through `lib/server/trading` (`modifyOrder`), which enforces the
 * §6 safety gate (re-valued notional / kill switch / hard limits / high-value /
 * DRY_RUN default / audit log) before any real POST. Bypassing the gate would
 * defeat every trading safeguard.
 */
export function modifyOrderRaw(
  client: TossClient,
  params: ModifyOrderRawParams,
): Promise<OrderOperationResponse> {
  return client.post(
    `/api/v1/orders/${encodeURIComponent(params.orderId)}/modify`,
    orderOperationResponseSchema,
    {
      group: "ORDER",
      accountSeq: params.accountSeq,
      body: params.body,
    },
  );
}

export interface CancelOrderRawParams {
  accountSeq: number | string;
  orderId: string;
}

/**
 * ⚠️ LOW-LEVEL, UNGATED real-money call: `POST /api/v1/orders/{orderId}/cancel`
 * (ORDER group, account header). This cancels an actual live order. The body is
 * an empty JSON object per the API contract.
 *
 * DO NOT call this directly from routes, UI, or other endpoints. It MUST only
 * be reached through `lib/server/trading` (`cancelOrder`), which enforces the
 * §6 safety gate (kill switch / DRY_RUN default / audit log) before any real
 * POST. Bypassing the gate would defeat every trading safeguard.
 */
export function cancelOrderRaw(
  client: TossClient,
  params: CancelOrderRawParams,
): Promise<OrderOperationResponse> {
  return client.post(
    `/api/v1/orders/${encodeURIComponent(params.orderId)}/cancel`,
    orderOperationResponseSchema,
    {
      group: "ORDER",
      accountSeq: params.accountSeq,
      body: {},
    },
  );
}

export interface GetStocksParams {
  symbols: string[];
}

/** `GET /api/v1/stocks` — `symbols` query is comma-joined, no account header. */
export function getStocks(
  client: TossClient,
  params: GetStocksParams,
): Promise<StockInfo[]> {
  return client.get("/api/v1/stocks", stocksResultSchema, {
    group: "STOCK",
    query: { symbols: params.symbols.join(",") },
  });
}

export interface GetStockWarningsParams {
  symbol: string;
}

/** `GET /api/v1/stocks/{symbol}/warnings` — path `symbol`, no account header. */
export function getStockWarnings(
  client: TossClient,
  params: GetStockWarningsParams,
): Promise<StockWarning[]> {
  return client.get(
    `/api/v1/stocks/${encodeURIComponent(params.symbol)}/warnings`,
    stockWarningsResultSchema,
    { group: "STOCK" },
  );
}

export interface GetKrMarketCalendarParams {
  date?: string;
}

/** `GET /api/v1/market-calendar/KR` — optional `date`, no account header. */
export function getKrMarketCalendar(
  client: TossClient,
  params: GetKrMarketCalendarParams = {},
): Promise<KrMarketCalendarResponse> {
  return client.get(
    "/api/v1/market-calendar/KR",
    krMarketCalendarResponseSchema,
    {
      group: "MARKET_INFO",
      query: { date: params.date },
    },
  );
}

export interface GetUsMarketCalendarParams {
  date?: string;
}

/** `GET /api/v1/market-calendar/US` — optional `date`, no account header. */
export function getUsMarketCalendar(
  client: TossClient,
  params: GetUsMarketCalendarParams = {},
): Promise<UsMarketCalendarResponse> {
  return client.get(
    "/api/v1/market-calendar/US",
    usMarketCalendarResponseSchema,
    {
      group: "MARKET_INFO",
      query: { date: params.date },
    },
  );
}

export interface GetBuyingPowerParams {
  accountSeq: number | string;
  currency: string;
}

/** `GET /api/v1/buying-power` — requires `X-Tossinvest-Account` and `currency`. */
export function getBuyingPower(
  client: TossClient,
  params: GetBuyingPowerParams,
): Promise<BuyingPowerResponse> {
  return client.get("/api/v1/buying-power", buyingPowerResponseSchema, {
    group: "ORDER_INFO",
    accountSeq: params.accountSeq,
    query: { currency: params.currency },
  });
}

export interface GetSellableQuantityParams {
  accountSeq: number | string;
  symbol: string;
}

/** `GET /api/v1/sellable-quantity` — requires `X-Tossinvest-Account` and `symbol`. */
export function getSellableQuantity(
  client: TossClient,
  params: GetSellableQuantityParams,
): Promise<SellableQuantityResponse> {
  return client.get(
    "/api/v1/sellable-quantity",
    sellableQuantityResponseSchema,
    {
      group: "ORDER_INFO",
      accountSeq: params.accountSeq,
      query: { symbol: params.symbol },
    },
  );
}

export interface GetCommissionsParams {
  accountSeq: number | string;
}

/** `GET /api/v1/commissions` — requires `X-Tossinvest-Account`. */
export function getCommissions(
  client: TossClient,
  params: GetCommissionsParams,
): Promise<Commission[]> {
  return client.get("/api/v1/commissions", commissionsResultSchema, {
    group: "ORDER_INFO",
    accountSeq: params.accountSeq,
  });
}
