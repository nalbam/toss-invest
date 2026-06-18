import "server-only";
import type { TossClient } from "@/lib/server/toss/client";
import {
  accountsResultSchema,
  exchangeRateResponseSchema,
  holdingsOverviewSchema,
  orderSchema,
  paginatedOrderResponseSchema,
  pricesResultSchema,
  type Account,
  type ExchangeRateResponse,
  type HoldingsOverview,
  type Order,
  type PaginatedOrderResponse,
  type PriceResponse,
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
