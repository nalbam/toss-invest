import "server-only";
import type { TossClient } from "@/lib/server/toss/client";
import {
  accountsResultSchema,
  exchangeRateResponseSchema,
  holdingsOverviewSchema,
  pricesResultSchema,
  type Account,
  type ExchangeRateResponse,
  type HoldingsOverview,
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
