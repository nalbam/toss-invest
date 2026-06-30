import { describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "@/lib/server/toss/auth";
import { createTossClient } from "@/lib/server/toss/client";
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
} from "@/lib/server/toss/endpoints";

const BASE_URL = "https://openapi.tossinvest.com";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const tokenProvider: TokenProvider = {
  getAccessToken: async () => "tok-abc",
  invalidate: () => {},
};

interface Harness {
  fetchFn: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
  client: ReturnType<typeof createTossClient>;
}

/**
 * Builds a client with a stub fetch + an always-immediate rate limiter so the
 * contract tests exercise URL/headers/envelope handling, not throttling.
 */
function harness(
  responses: Response[],
  opts: { random?: () => number } = {},
): Harness {
  const queue = [...responses];
  const fetchFn = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
  const sleep = vi.fn(async () => {});
  const client = createTossClient({
    tokenProvider,
    fetchFn,
    now: () => 0,
    sleep,
    rateLimiter: { acquire: async () => 0 },
    baseUrl: BASE_URL,
    random: opts.random ?? (() => 0),
  });
  return { fetchFn, sleep, client };
}

function lastRequest(fetchFn: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchFn.mock.calls[index] as [string, RequestInit];
  return { url: new URL(url), headers: init.headers as Record<string, string> };
}

// --- accounts ---------------------------------------------------------------

describe("getAccounts", () => {
  it("calls the accounts URL with a Bearer token and no account header", async () => {
    const { fetchFn, client } = harness([
      jsonResponse({
        result: [{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }],
      }),
    ]);

    const accounts = await getAccounts(client);

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/accounts");
    expect(headers.authorization).toBe("Bearer tok-abc");
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(accounts).toEqual([
      { accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" },
    ]);
  });

  it("unwraps an empty result array", async () => {
    const { client } = harness([jsonResponse({ result: [] })]);
    expect(await getAccounts(client)).toEqual([]);
  });
});

// --- holdings ---------------------------------------------------------------

const holdingsResult = {
  totalPurchaseAmount: { krw: "1000000", usd: null },
  marketValue: {
    amount: { krw: "1100000", usd: null },
    amountAfterCost: { krw: "1085600", usd: null },
  },
  profitLoss: {
    amount: { krw: "100000", usd: null },
    amountAfterCost: { krw: "85600", usd: null },
    rate: "0.1",
    rateAfterCost: "0.0856",
  },
  dailyProfitLoss: {
    amount: { krw: "5000", usd: null },
    rate: "0.0045",
  },
  items: [
    {
      symbol: "005930",
      name: "삼성전자",
      marketCountry: "KR",
      currency: "KRW",
      quantity: "10",
      lastPrice: "72000",
      averagePurchasePrice: "70000",
      marketValue: { purchaseAmount: "700000", amount: "720000", amountAfterCost: "705600" },
      profitLoss: { amount: "20000", amountAfterCost: "5600", rate: "0.0286", rateAfterCost: "0.008" },
      dailyProfitLoss: { amount: "3000", rate: "0.0042" },
      cost: { commission: "14400", tax: "135600" },
    },
  ],
};

describe("getHoldings", () => {
  it("sends X-Tossinvest-Account and preserves decimal strings", async () => {
    const { fetchFn, client } = harness([jsonResponse({ result: holdingsResult })]);

    const overview = await getHoldings(client, { accountSeq: 1 });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/holdings");
    expect(headers["x-tossinvest-account"]).toBe("1");
    expect(url.searchParams.has("symbol")).toBe(false);
    // decimals stay strings, not coerced numbers
    expect(overview.profitLoss.rate).toBe("0.1");
    expect(typeof overview.items[0].quantity).toBe("string");
    expect(overview.items[0].cost).toEqual({ commission: "14400", tax: "135600" });
    expect(overview.totalPurchaseAmount.usd).toBeNull();
  });

  it("forwards the symbol query when provided", async () => {
    const { fetchFn, client } = harness([jsonResponse({ result: holdingsResult })]);

    await getHoldings(client, { accountSeq: 7, symbol: "005930" });

    const { url, headers } = lastRequest(fetchFn);
    expect(headers["x-tossinvest-account"]).toBe("7");
    expect(url.searchParams.get("symbol")).toBe("005930");
  });

  it("accepts a null tax in cost", async () => {
    const result = {
      ...holdingsResult,
      items: [{ ...holdingsResult.items[0], cost: { commission: "100", tax: null } }],
    };
    const { client } = harness([jsonResponse({ result })]);

    const overview = await getHoldings(client, { accountSeq: 1 });
    expect(overview.items[0].cost.tax).toBeNull();
  });
});

// --- prices -----------------------------------------------------------------

describe("getPrices", () => {
  it("joins symbols with commas and unwraps the price array", async () => {
    const { fetchFn, client } = harness([
      jsonResponse({
        result: [
          { symbol: "005930", timestamp: "2026-03-25T09:30:00.123+09:00", lastPrice: "72000", currency: "KRW" },
          { symbol: "000660", timestamp: null, lastPrice: "180000", currency: "KRW" },
        ],
      }),
    ]);

    const prices = await getPrices(client, { symbols: ["005930", "000660"] });

    const { url } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/prices");
    expect(url.searchParams.get("symbols")).toBe("005930,000660");
    expect(prices).toHaveLength(2);
    expect(prices[0].lastPrice).toBe("72000");
    expect(prices[1].timestamp).toBeNull();
  });

  it("accepts an unknown currency enum value without throwing", async () => {
    const { client } = harness([
      jsonResponse({
        result: [{ symbol: "7203", lastPrice: "2500", currency: "JPY" }],
      }),
    ]);

    const prices = await getPrices(client, { symbols: ["7203"] });
    expect(prices[0].currency).toBe("JPY");
  });
});

// --- orderbook --------------------------------------------------------------

/**
 * Like `harness` but captures the rate-limit group passed to each acquire so
 * the market-data contract tests can assert the correct TPS budget is used.
 */
function groupHarness(responses: Response[]) {
  const queue = [...responses];
  const fetchFn = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
  const groups: string[] = [];
  const client = createTossClient({
    tokenProvider,
    fetchFn,
    now: () => 0,
    sleep: vi.fn(async () => {}),
    rateLimiter: {
      acquire: async (group) => {
        groups.push(group);
        return 0;
      },
    },
    baseUrl: BASE_URL,
    random: () => 0,
  });
  return { fetchFn, client, groups };
}

describe("getOrderbook", () => {
  const orderbook = {
    timestamp: "2026-03-25T09:30:00.123+09:00",
    currency: "KRW",
    asks: [
      { price: "72100", volume: "10" },
      { price: "72200", volume: "5" },
    ],
    bids: [{ price: "72000", volume: "12.5" }],
  };

  it("sends symbol, no account header, uses MARKET_DATA, and preserves decimals", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: orderbook }),
    ]);

    const result = await getOrderbook(client, { symbol: "005930" });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/orderbook");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["MARKET_DATA"]);
    expect(result.asks[0]).toEqual({ price: "72100", volume: "10" });
    expect(result.bids[0].volume).toBe("12.5");
    expect(typeof result.asks[0].price).toBe("string");
  });

  it("accepts a null timestamp and an unknown currency", async () => {
    const { client } = groupHarness([
      jsonResponse({
        result: { ...orderbook, timestamp: null, currency: "JPY" },
      }),
    ]);

    const result = await getOrderbook(client, { symbol: "7203" });
    expect(result.timestamp).toBeNull();
    expect(result.currency).toBe("JPY");
  });
});

// --- trades -----------------------------------------------------------------

describe("getTrades", () => {
  const trades = [
    {
      price: "72000",
      volume: "3",
      timestamp: "2026-03-25T09:30:00.100+09:00",
      currency: "KRW",
    },
    {
      price: "72100",
      volume: "1.5",
      timestamp: "2026-03-25T09:30:01.200+09:00",
      currency: "KRW",
    },
  ];

  it("sends symbol, uses MARKET_DATA, and preserves decimal strings", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: trades }),
    ]);

    const result = await getTrades(client, { symbol: "005930" });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/trades");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(url.searchParams.has("count")).toBe(false);
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["MARKET_DATA"]);
    expect(result).toHaveLength(2);
    expect(result[0].price).toBe("72000");
    expect(result[1].volume).toBe("1.5");
  });

  it("forwards the count query when provided", async () => {
    const { fetchFn, client } = groupHarness([jsonResponse({ result: [] })]);

    await getTrades(client, { symbol: "005930", count: 50 });

    const { url } = lastRequest(fetchFn);
    expect(url.searchParams.get("count")).toBe("50");
  });
});

// --- price-limits -----------------------------------------------------------

describe("getPriceLimits", () => {
  it("sends symbol, uses MARKET_DATA, and preserves decimal limit strings", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({
        result: {
          timestamp: "2026-03-25T09:30:00+09:00",
          upperLimitPrice: "93600",
          lowerLimitPrice: "50400",
          currency: "KRW",
        },
      }),
    ]);

    const result = await getPriceLimits(client, { symbol: "005930" });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/price-limits");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["MARKET_DATA"]);
    expect(result.upperLimitPrice).toBe("93600");
    expect(result.lowerLimitPrice).toBe("50400");
  });

  it("accepts null upper/lower limits (e.g. US markets) and unknown currency", async () => {
    const { client } = groupHarness([
      jsonResponse({
        result: {
          timestamp: "2026-03-25T13:30:00Z",
          upperLimitPrice: null,
          lowerLimitPrice: null,
          currency: "USD",
        },
      }),
    ]);

    const result = await getPriceLimits(client, { symbol: "AAPL" });
    expect(result.upperLimitPrice).toBeNull();
    expect(result.lowerLimitPrice).toBeNull();
    expect(result.currency).toBe("USD");
  });
});

// --- candles ----------------------------------------------------------------

describe("getCandles", () => {
  const candlePage = {
    candles: [
      {
        timestamp: "2026-03-25T09:30:00+09:00",
        openPrice: "72000",
        highPrice: "72500",
        lowPrice: "71800",
        closePrice: "72300",
        volume: "12345.5",
        currency: "KRW",
      },
    ],
    nextBefore: "2026-03-25T09:29:00+09:00",
  };

  it("sends symbol + interval, uses MARKET_DATA_CHART, and preserves OHLCV strings", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: candlePage }),
    ]);

    const result = await getCandles(client, {
      symbol: "005930",
      interval: "1d",
    });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/candles");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(url.searchParams.get("interval")).toBe("1d");
    expect(url.searchParams.has("count")).toBe(false);
    expect(url.searchParams.has("before")).toBe(false);
    expect(url.searchParams.has("adjusted")).toBe(false);
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["MARKET_DATA_CHART"]);
    expect(result.candles[0].openPrice).toBe("72000");
    expect(result.candles[0].volume).toBe("12345.5");
    expect(typeof result.candles[0].closePrice).toBe("string");
  });

  it("forwards count, before, and adjusted; exposes the nextBefore cursor", async () => {
    const { fetchFn, client } = groupHarness([
      jsonResponse({ result: candlePage }),
    ]);

    const result = await getCandles(client, {
      symbol: "005930",
      interval: "1m",
      count: 200,
      before: "2026-03-25T09:30:00+09:00",
      adjusted: true,
    });

    const { url } = lastRequest(fetchFn);
    expect(url.searchParams.get("interval")).toBe("1m");
    expect(url.searchParams.get("count")).toBe("200");
    expect(url.searchParams.get("before")).toBe("2026-03-25T09:30:00+09:00");
    expect(url.searchParams.get("adjusted")).toBe("true");
    expect(result.nextBefore).toBe("2026-03-25T09:29:00+09:00");
  });

  it("accepts a null nextBefore on the final page", async () => {
    const { client } = groupHarness([
      jsonResponse({ result: { candles: [], nextBefore: null } }),
    ]);

    const result = await getCandles(client, { symbol: "005930", interval: "1d" });
    expect(result.candles).toEqual([]);
    expect(result.nextBefore).toBeNull();
  });
});

// --- exchange-rate ----------------------------------------------------------

describe("getExchangeRate", () => {
  const exchangeRate = {
    baseCurrency: "USD",
    quoteCurrency: "KRW",
    rate: "1380.5",
    midRate: "1375",
    basisPoint: "40",
    rateChangeType: "UP",
    validFrom: "2026-03-25T09:30:00+09:00",
    validUntil: "2026-03-25T09:31:00+09:00",
  };

  it("sends base/quote currency and preserves decimal rate strings", async () => {
    const { fetchFn, client } = harness([jsonResponse({ result: exchangeRate })]);

    const result = await getExchangeRate(client, {
      baseCurrency: "USD",
      quoteCurrency: "KRW",
    });

    const { url } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/exchange-rate");
    expect(url.searchParams.get("baseCurrency")).toBe("USD");
    expect(url.searchParams.get("quoteCurrency")).toBe("KRW");
    expect(url.searchParams.has("dateTime")).toBe(false);
    expect(result.rate).toBe("1380.5");
    expect(result.rateChangeType).toBe("UP");
  });

  it("forwards dateTime when provided", async () => {
    const { fetchFn, client } = harness([jsonResponse({ result: exchangeRate })]);

    await getExchangeRate(client, {
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      dateTime: "2026-03-25T09:30:00+09:00",
    });

    const { url } = lastRequest(fetchFn);
    expect(url.searchParams.get("dateTime")).toBe("2026-03-25T09:30:00+09:00");
  });
});

// --- orders -----------------------------------------------------------------

const openOrder = {
  orderId: "ord-1",
  symbol: "005930",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  status: "PENDING",
  price: "71000",
  quantity: "10",
  orderAmount: "710000",
  currency: "KRW",
  orderedAt: "2026-03-25T09:30:00+09:00",
  canceledAt: null,
  execution: {
    filledQuantity: "0",
    averageFilledPrice: null,
    filledAmount: null,
    commission: null,
    tax: null,
    filledAt: null,
    settlementDate: null,
  },
};

describe("getOrders", () => {
  it("sends X-Tossinvest-Account, the status query, and unwraps pagination", async () => {
    const { fetchFn, client } = harness([
      jsonResponse({
        result: { orders: [openOrder], nextCursor: null, hasNext: false },
      }),
    ]);

    const page = await getOrders(client, { accountSeq: 1, status: "OPEN" });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/orders");
    expect(headers["x-tossinvest-account"]).toBe("1");
    expect(url.searchParams.get("status")).toBe("OPEN");
    expect(url.searchParams.has("symbol")).toBe(false);
    expect(page.orders).toHaveLength(1);
    expect(page.orders[0].quantity).toBe("10");
    expect(page.orders[0].execution.filledQuantity).toBe("0");
    expect(page.nextCursor).toBeNull();
    expect(page.hasNext).toBe(false);
  });

  it("forwards symbol, cursor, and limit when provided", async () => {
    const { fetchFn, client } = harness([
      jsonResponse({
        result: { orders: [], nextCursor: null, hasNext: false },
      }),
    ]);

    await getOrders(client, {
      accountSeq: 7,
      status: "OPEN",
      symbol: "005930",
      cursor: "abc",
      limit: 50,
    });

    const { url, headers } = lastRequest(fetchFn);
    expect(headers["x-tossinvest-account"]).toBe("7");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(url.searchParams.get("cursor")).toBe("abc");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("accepts an unknown order status value without throwing", async () => {
    const { client } = harness([
      jsonResponse({
        result: {
          orders: [{ ...openOrder, status: "SOMETHING_NEW" }],
          nextCursor: null,
          hasNext: false,
        },
      }),
    ]);

    const page = await getOrders(client, { accountSeq: 1, status: "OPEN" });
    expect(page.orders[0].status).toBe("SOMETHING_NEW");
  });

  it("fetches CLOSED (terminal) orders with symbol/limit and unwraps pagination", async () => {
    const { fetchFn, client } = harness([
      jsonResponse({
        result: {
          orders: [{ ...openOrder, status: "FILLED" }],
          nextCursor: "next-1",
          hasNext: true,
        },
      }),
    ]);

    const page = await getOrders(client, {
      accountSeq: 1,
      status: "CLOSED",
      symbol: "005930",
      limit: 20,
    });

    const { url } = lastRequest(fetchFn);
    expect(url.searchParams.get("status")).toBe("CLOSED");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(page.orders[0].status).toBe("FILLED");
    expect(page.nextCursor).toBe("next-1");
    expect(page.hasNext).toBe(true);
  });
});

describe("getOrder", () => {
  it("requests the order path with the account header", async () => {
    const { fetchFn, client } = harness([jsonResponse({ result: openOrder })]);

    const order = await getOrder(client, { accountSeq: 3, orderId: "ord-1" });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/orders/ord-1");
    expect(headers["x-tossinvest-account"]).toBe("3");
    expect(order.orderId).toBe("ord-1");
    expect(order.execution.filledQuantity).toBe("0");
  });

  it("url-encodes the orderId in the path", async () => {
    const { fetchFn, client } = harness([
      jsonResponse({ result: { ...openOrder, orderId: "a/b c" } }),
    ]);

    await getOrder(client, { accountSeq: 1, orderId: "a/b c" });

    const { url } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/orders/a%2Fb%20c");
  });
});

// --- stocks -----------------------------------------------------------------

describe("getStocks", () => {
  const krStock = {
    symbol: "005930",
    name: "삼성전자",
    englishName: "SamsungElec",
    isinCode: "KR7005930003",
    market: "KOSPI",
    securityType: "STOCK",
    isCommonShare: true,
    status: "ACTIVE",
    currency: "KRW",
    listDate: "1975-06-11",
    delistDate: null,
    sharesOutstanding: "5919637922",
    leverageFactor: null,
    koreanMarketDetail: {
      liquidationTrading: false,
      nxtSupported: true,
      krxTradingSuspended: false,
      nxtTradingSuspended: false,
    },
  };

  it("joins symbols with commas, uses STOCK, no account header, preserves decimals", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: [krStock] }),
    ]);

    const result = await getStocks(client, { symbols: ["005930", "000660"] });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/stocks");
    expect(url.searchParams.get("symbols")).toBe("005930,000660");
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["STOCK"]);
    expect(result).toHaveLength(1);
    expect(result[0].sharesOutstanding).toBe("5919637922");
    expect(typeof result[0].sharesOutstanding).toBe("string");
    expect(result[0].koreanMarketDetail?.nxtSupported).toBe(true);
    expect(result[0].delistDate).toBeNull();
    expect(result[0].leverageFactor).toBeNull();
  });

  it("accepts a null koreanMarketDetail and unknown enum values", async () => {
    const usStock = {
      symbol: "AAPL",
      name: "애플",
      englishName: "Apple Inc.",
      isinCode: "US0378331005",
      market: "MOON_EXCHANGE",
      securityType: "SPACE_STOCK",
      isCommonShare: true,
      status: "ORBITING",
      currency: "USD",
      sharesOutstanding: "15000000000",
      koreanMarketDetail: null,
    };
    const { client } = groupHarness([jsonResponse({ result: [usStock] })]);

    const result = await getStocks(client, { symbols: ["AAPL"] });
    expect(result[0].market).toBe("MOON_EXCHANGE");
    expect(result[0].securityType).toBe("SPACE_STOCK");
    expect(result[0].status).toBe("ORBITING");
    expect(result[0].koreanMarketDetail).toBeNull();
  });
});

// --- stock warnings ---------------------------------------------------------

describe("getStockWarnings", () => {
  it("requests the warnings path, uses STOCK, no account header", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({
        result: [
          {
            warningType: "VI_STATIC",
            exchange: "KRX",
            startDate: "2026-03-26",
            endDate: "2026-03-27",
          },
        ],
      }),
    ]);

    const result = await getStockWarnings(client, { symbol: "005930" });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/stocks/005930/warnings");
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["STOCK"]);
    expect(result[0].warningType).toBe("VI_STATIC");
    expect(result[0].exchange).toBe("KRX");
  });

  it("accepts null exchange/dates and an unknown warningType", async () => {
    const { client } = groupHarness([
      jsonResponse({
        result: [
          {
            warningType: "BRAND_NEW_WARNING",
            exchange: null,
            startDate: null,
            endDate: null,
          },
        ],
      }),
    ]);

    const result = await getStockWarnings(client, { symbol: "005930" });
    expect(result[0].warningType).toBe("BRAND_NEW_WARNING");
    expect(result[0].exchange).toBeNull();
    expect(result[0].startDate).toBeNull();
  });

  it("url-encodes the symbol in the path", async () => {
    const { fetchFn, client } = groupHarness([jsonResponse({ result: [] })]);

    await getStockWarnings(client, { symbol: "a/b" });

    const { url } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/stocks/a%2Fb/warnings");
  });
});

// --- market-calendar (KR) ---------------------------------------------------

describe("getKrMarketCalendar", () => {
  const krDay = {
    date: "2026-03-25",
    integrated: {
      preMarket: {
        startTime: "2026-03-25T08:00:00+09:00",
        singlePriceAuctionStartTime: "2026-03-25T08:50:00+09:00",
        endTime: "2026-03-25T09:00:00+09:00",
      },
      regularMarket: {
        startTime: "2026-03-25T09:00:00+09:00",
        singlePriceAuctionStartTime: "2026-03-25T15:20:00+09:00",
        endTime: "2026-03-25T15:30:00+09:00",
      },
      afterMarket: {
        startTime: "2026-03-25T15:30:00+09:00",
        singlePriceAuctionEndTime: "2026-03-25T15:40:00+09:00",
        endTime: "2026-03-25T20:00:00+09:00",
      },
    },
  };
  const calendar = {
    today: krDay,
    previousBusinessDay: krDay,
    nextBusinessDay: krDay,
  };

  it("uses MARKET_INFO, no account header, omits date when not provided", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: calendar }),
    ]);

    const result = await getKrMarketCalendar(client);

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/market-calendar/KR");
    expect(url.searchParams.has("date")).toBe(false);
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["MARKET_INFO"]);
    expect(result.today.date).toBe("2026-03-25");
    expect(result.today.integrated?.regularMarket?.startTime).toBe(
      "2026-03-25T09:00:00+09:00",
    );
  });

  it("forwards the date query and accepts a null integrated (holiday)", async () => {
    const { fetchFn, client } = groupHarness([
      jsonResponse({
        result: {
          today: { date: "2026-03-21", integrated: null },
          previousBusinessDay: krDay,
          nextBusinessDay: krDay,
        },
      }),
    ]);

    const result = await getKrMarketCalendar(client, { date: "2026-03-21" });

    const { url } = lastRequest(fetchFn);
    expect(url.searchParams.get("date")).toBe("2026-03-21");
    expect(result.today.integrated).toBeNull();
  });

  it("accepts null nested session fields", async () => {
    const { client } = groupHarness([
      jsonResponse({
        result: {
          today: {
            date: "2026-03-25",
            integrated: {
              preMarket: null,
              regularMarket: {
                startTime: "2026-03-25T09:00:00+09:00",
                singlePriceAuctionStartTime: null,
                endTime: "2026-03-25T15:30:00+09:00",
              },
              afterMarket: null,
            },
          },
          previousBusinessDay: krDay,
          nextBusinessDay: krDay,
        },
      }),
    ]);

    const result = await getKrMarketCalendar(client);
    expect(result.today.integrated?.preMarket).toBeNull();
    expect(
      result.today.integrated?.regularMarket?.singlePriceAuctionStartTime,
    ).toBeNull();
  });
});

// --- market-calendar (US) ---------------------------------------------------

describe("getUsMarketCalendar", () => {
  const usDay = {
    date: "2026-03-25",
    dayMarket: {
      startTime: "2026-03-25T09:00:00+09:00",
      endTime: "2026-03-25T16:50:00+09:00",
    },
    preMarket: {
      startTime: "2026-03-25T17:00:00+09:00",
      endTime: "2026-03-25T22:30:00+09:00",
    },
    regularMarket: {
      startTime: "2026-03-25T22:30:00+09:00",
      endTime: "2026-03-26T05:00:00+09:00",
    },
    afterMarket: {
      startTime: "2026-03-26T05:00:00+09:00",
      endTime: "2026-03-26T07:00:00+09:00",
    },
  };
  const calendar = {
    today: usDay,
    previousBusinessDay: usDay,
    nextBusinessDay: usDay,
  };

  it("uses MARKET_INFO, no account header, omits date when not provided", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: calendar }),
    ]);

    const result = await getUsMarketCalendar(client);

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/market-calendar/US");
    expect(url.searchParams.has("date")).toBe(false);
    expect(headers["x-tossinvest-account"]).toBeUndefined();
    expect(groups).toEqual(["MARKET_INFO"]);
    expect(result.today.regularMarket?.startTime).toBe(
      "2026-03-25T22:30:00+09:00",
    );
  });

  it("forwards date and accepts all-null sessions (holiday)", async () => {
    const { fetchFn, client } = groupHarness([
      jsonResponse({
        result: {
          today: {
            date: "2026-12-25",
            dayMarket: null,
            preMarket: null,
            regularMarket: null,
            afterMarket: null,
          },
          previousBusinessDay: usDay,
          nextBusinessDay: usDay,
        },
      }),
    ]);

    const result = await getUsMarketCalendar(client, { date: "2026-12-25" });

    const { url } = lastRequest(fetchFn);
    expect(url.searchParams.get("date")).toBe("2026-12-25");
    expect(result.today.dayMarket).toBeNull();
    expect(result.today.regularMarket).toBeNull();
  });
});

// --- buying-power -----------------------------------------------------------

describe("getBuyingPower", () => {
  it("sends X-Tossinvest-Account + currency, uses ORDER_INFO, preserves decimal", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: { currency: "KRW", cashBuyingPower: "5000000" } }),
    ]);

    const result = await getBuyingPower(client, {
      accountSeq: 7,
      currency: "KRW",
    });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/buying-power");
    expect(url.searchParams.get("currency")).toBe("KRW");
    expect(headers["x-tossinvest-account"]).toBe("7");
    expect(groups).toEqual(["ORDER_INFO"]);
    expect(result.cashBuyingPower).toBe("5000000");
    expect(typeof result.cashBuyingPower).toBe("string");
  });

  it("accepts an unknown currency enum value", async () => {
    const { client } = groupHarness([
      jsonResponse({ result: { currency: "JPY", cashBuyingPower: "100.5" } }),
    ]);

    const result = await getBuyingPower(client, {
      accountSeq: 1,
      currency: "JPY",
    });
    expect(result.currency).toBe("JPY");
  });
});

// --- sellable-quantity ------------------------------------------------------

describe("getSellableQuantity", () => {
  it("sends X-Tossinvest-Account + symbol, uses ORDER_INFO, preserves decimal", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({ result: { sellableQuantity: "100" } }),
    ]);

    const result = await getSellableQuantity(client, {
      accountSeq: 3,
      symbol: "005930",
    });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/sellable-quantity");
    expect(url.searchParams.get("symbol")).toBe("005930");
    expect(headers["x-tossinvest-account"]).toBe("3");
    expect(groups).toEqual(["ORDER_INFO"]);
    expect(result.sellableQuantity).toBe("100");
    expect(typeof result.sellableQuantity).toBe("string");
  });
});

// --- commissions ------------------------------------------------------------

describe("getCommissions", () => {
  it("sends X-Tossinvest-Account, uses ORDER_INFO, unwraps the commission array", async () => {
    const { fetchFn, client, groups } = groupHarness([
      jsonResponse({
        result: [
          {
            marketCountry: "KR",
            commissionRate: "0.015",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
          },
          {
            marketCountry: "US",
            commissionRate: "0.25",
            startDate: null,
            endDate: null,
          },
        ],
      }),
    ]);

    const result = await getCommissions(client, { accountSeq: 1 });

    const { url, headers } = lastRequest(fetchFn);
    expect(url.pathname).toBe("/api/v1/commissions");
    expect(headers["x-tossinvest-account"]).toBe("1");
    expect(groups).toEqual(["ORDER_INFO"]);
    expect(result).toHaveLength(2);
    expect(result[0].commissionRate).toBe("0.015");
    expect(result[1].startDate).toBeNull();
  });

  it("accepts an unknown marketCountry enum value", async () => {
    const { client } = groupHarness([
      jsonResponse({
        result: [{ marketCountry: "JP", commissionRate: "0.1" }],
      }),
    ]);

    const result = await getCommissions(client, { accountSeq: 1 });
    expect(result[0].marketCountry).toBe("JP");
  });
});
