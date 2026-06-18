import { describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "@/lib/server/toss/auth";
import { createTossClient, TossApiError } from "@/lib/server/toss/client";
import {
  getAccounts,
  getExchangeRate,
  getHoldings,
  getOrder,
  getOrders,
  getPrices,
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

  it("maps a CLOSED 400 to a TossApiError with the upstream code", async () => {
    const { client } = harness([
      jsonResponse(
        {
          error: {
            requestId: "req-1",
            code: "closed-not-supported",
            message: "CLOSED orders are not supported",
          },
        },
        { status: 400 },
      ),
    ]);

    const error = await getOrders(client, {
      accountSeq: 1,
      status: "CLOSED",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TossApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "closed-not-supported",
    });
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
