import { beforeEach, describe, expect, it, vi } from "vitest";
import { TossApiError } from "@/lib/server/toss/client";

// Mock the server container so route handlers exercise only their own
// validation/mapping logic against a fake endpoint facade.
const facade = {
  getAccounts: vi.fn(),
  getHoldings: vi.fn(),
  getPrices: vi.fn(),
  getOrderbook: vi.fn(),
  getTrades: vi.fn(),
  getPriceLimits: vi.fn(),
  getCandles: vi.fn(),
  getExchangeRate: vi.fn(),
  getOrders: vi.fn(),
  getOrder: vi.fn(),
};

vi.mock("@/lib/server/toss/container", () => ({
  getServerTossClient: () => facade,
}));

import { GET as accountsGET } from "@/app/api/accounts/route";
import { GET as holdingsGET } from "@/app/api/holdings/route";
import { GET as pricesGET } from "@/app/api/prices/route";
import { GET as orderbookGET } from "@/app/api/orderbook/route";
import { GET as tradesGET } from "@/app/api/trades/route";
import { GET as priceLimitsGET } from "@/app/api/price-limits/route";
import { GET as candlesGET } from "@/app/api/candles/route";
import { GET as exchangeRateGET } from "@/app/api/exchange-rate/route";
import { GET as ordersGET } from "@/app/api/orders/route";
import { GET as orderGET } from "@/app/api/orders/[orderId]/route";

const SECRET = "super-secret-client-secret-value";

function req(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- accounts ---------------------------------------------------------------

describe("GET /api/accounts", () => {
  it("returns 200 with the accounts under a data envelope", async () => {
    const accounts = [
      { accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" },
    ];
    facade.getAccounts.mockResolvedValue(accounts);

    const res = await accountsGET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: accounts });
  });

  it("maps a TossApiError to its status without leaking secrets", async () => {
    facade.getAccounts.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "account-not-found",
        message: "account not found",
        requestId: "req-1",
      }),
    );

    const res = await accountsGET();

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("account-not-found");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("maps an unknown error to a generic 500", async () => {
    facade.getAccounts.mockRejectedValue(
      new Error(`boom containing ${SECRET}`),
    );

    const res = await accountsGET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal-error");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

// --- holdings ---------------------------------------------------------------

describe("GET /api/holdings", () => {
  const holdings = { items: [] };

  it("uses the provided accountSeq and forwards the symbol", async () => {
    facade.getHoldings.mockResolvedValue(holdings);

    const res = await holdingsGET(
      req("http://localhost/api/holdings?accountSeq=7&symbol=005930"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: holdings });
    expect(facade.getHoldings).toHaveBeenCalledWith({
      accountSeq: 7,
      symbol: "005930",
    });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
      { accountNo: "2", accountSeq: 99, accountType: "BROKERAGE" },
    ]);
    facade.getHoldings.mockResolvedValue(holdings);

    const res = await holdingsGET(req("http://localhost/api/holdings"));

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getHoldings).toHaveBeenCalledWith({
      accountSeq: 42,
      symbol: undefined,
    });
  });

  it("returns 400 for a non-integer accountSeq", async () => {
    const res = await holdingsGET(
      req("http://localhost/api/holdings?accountSeq=abc"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getHoldings).not.toHaveBeenCalled();
  });

  it("maps an upstream TossApiError to its status", async () => {
    facade.getHoldings.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "account-not-found",
        message: "account not found",
      }),
    );

    const res = await holdingsGET(
      req("http://localhost/api/holdings?accountSeq=7"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("account-not-found");
  });
});

// --- prices -----------------------------------------------------------------

describe("GET /api/prices", () => {
  it("splits symbols into an array and returns 200", async () => {
    const prices = [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }];
    facade.getPrices.mockResolvedValue(prices);

    const res = await pricesGET(
      req("http://localhost/api/prices?symbols=005930,000660"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: prices });
    expect(facade.getPrices).toHaveBeenCalledWith({
      symbols: ["005930", "000660"],
    });
  });

  it("returns 400 when symbols is missing", async () => {
    const res = await pricesGET(req("http://localhost/api/prices"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getPrices).not.toHaveBeenCalled();
  });
});

// --- orderbook --------------------------------------------------------------

describe("GET /api/orderbook", () => {
  const orderbook = { timestamp: null, currency: "KRW", asks: [], bids: [] };

  it("forwards the symbol and returns 200", async () => {
    facade.getOrderbook.mockResolvedValue(orderbook);

    const res = await orderbookGET(
      req("http://localhost/api/orderbook?symbol=005930"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: orderbook });
    expect(facade.getOrderbook).toHaveBeenCalledWith({ symbol: "005930" });
  });

  it("returns 400 when symbol is missing", async () => {
    const res = await orderbookGET(req("http://localhost/api/orderbook"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getOrderbook).not.toHaveBeenCalled();
  });

  it("maps an upstream TossApiError to its status", async () => {
    facade.getOrderbook.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "symbol-not-found",
        message: "symbol not found",
        requestId: "req-1",
      }),
    );

    const res = await orderbookGET(
      req("http://localhost/api/orderbook?symbol=XXXX"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("symbol-not-found");
  });

  it("maps an unknown error to a generic 500 without leaking secrets", async () => {
    facade.getOrderbook.mockRejectedValue(
      new Error(`boom containing ${SECRET}`),
    );

    const res = await orderbookGET(
      req("http://localhost/api/orderbook?symbol=005930"),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal-error");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

// --- trades -----------------------------------------------------------------

describe("GET /api/trades", () => {
  it("forwards the symbol and count and returns 200", async () => {
    const trades = [
      { price: "72000", volume: "3", timestamp: "t", currency: "KRW" },
    ];
    facade.getTrades.mockResolvedValue(trades);

    const res = await tradesGET(
      req("http://localhost/api/trades?symbol=005930&count=50"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: trades });
    expect(facade.getTrades).toHaveBeenCalledWith({
      symbol: "005930",
      count: 50,
    });
  });

  it("omits count when not provided", async () => {
    facade.getTrades.mockResolvedValue([]);

    const res = await tradesGET(
      req("http://localhost/api/trades?symbol=005930"),
    );

    expect(res.status).toBe(200);
    expect(facade.getTrades).toHaveBeenCalledWith({
      symbol: "005930",
      count: undefined,
    });
  });

  it("returns 400 when symbol is missing", async () => {
    const res = await tradesGET(req("http://localhost/api/trades?count=10"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getTrades).not.toHaveBeenCalled();
  });
});

// --- price-limits -----------------------------------------------------------

describe("GET /api/price-limits", () => {
  const limits = {
    timestamp: "t",
    upperLimitPrice: null,
    lowerLimitPrice: null,
    currency: "USD",
  };

  it("forwards the symbol and returns 200", async () => {
    facade.getPriceLimits.mockResolvedValue(limits);

    const res = await priceLimitsGET(
      req("http://localhost/api/price-limits?symbol=AAPL"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: limits });
    expect(facade.getPriceLimits).toHaveBeenCalledWith({ symbol: "AAPL" });
  });

  it("returns 400 when symbol is missing", async () => {
    const res = await priceLimitsGET(
      req("http://localhost/api/price-limits"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getPriceLimits).not.toHaveBeenCalled();
  });
});

// --- candles ----------------------------------------------------------------

describe("GET /api/candles", () => {
  const page = { candles: [], nextBefore: null };

  it("forwards symbol + interval and returns 200", async () => {
    facade.getCandles.mockResolvedValue(page);

    const res = await candlesGET(
      req("http://localhost/api/candles?symbol=005930&interval=1d"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: page });
    expect(facade.getCandles).toHaveBeenCalledWith({
      symbol: "005930",
      interval: "1d",
      count: undefined,
      before: undefined,
      adjusted: undefined,
    });
  });

  it("coerces count and adjusted and forwards before", async () => {
    facade.getCandles.mockResolvedValue(page);

    const res = await candlesGET(
      req(
        "http://localhost/api/candles?symbol=005930&interval=1m&count=200&before=2026-03-25T09:30:00%2B09:00&adjusted=true",
      ),
    );

    expect(res.status).toBe(200);
    expect(facade.getCandles).toHaveBeenCalledWith({
      symbol: "005930",
      interval: "1m",
      count: 200,
      before: "2026-03-25T09:30:00+09:00",
      adjusted: true,
    });
  });

  it("returns 400 when interval is missing", async () => {
    const res = await candlesGET(
      req("http://localhost/api/candles?symbol=005930"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getCandles).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid interval", async () => {
    const res = await candlesGET(
      req("http://localhost/api/candles?symbol=005930&interval=5m"),
    );

    expect(res.status).toBe(400);
    expect(facade.getCandles).not.toHaveBeenCalled();
  });

  it("returns 400 when symbol is missing", async () => {
    const res = await candlesGET(
      req("http://localhost/api/candles?interval=1d"),
    );

    expect(res.status).toBe(400);
    expect(facade.getCandles).not.toHaveBeenCalled();
  });
});

// --- exchange-rate ----------------------------------------------------------

describe("GET /api/exchange-rate", () => {
  const rate = { baseCurrency: "USD", quoteCurrency: "KRW", rate: "1380.5" };

  it("forwards base/quote/dateTime and returns 200", async () => {
    facade.getExchangeRate.mockResolvedValue(rate);

    const res = await exchangeRateGET(
      req(
        "http://localhost/api/exchange-rate?baseCurrency=USD&quoteCurrency=KRW&dateTime=2026-03-25T09:30:00%2B09:00",
      ),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: rate });
    expect(facade.getExchangeRate).toHaveBeenCalledWith({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      dateTime: "2026-03-25T09:30:00+09:00",
    });
  });

  it("returns 400 when quoteCurrency is missing", async () => {
    const res = await exchangeRateGET(
      req("http://localhost/api/exchange-rate?baseCurrency=USD"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getExchangeRate).not.toHaveBeenCalled();
  });
});

// --- orders -----------------------------------------------------------------

describe("GET /api/orders", () => {
  const page = { orders: [], nextCursor: null, hasNext: false };

  it("defaults status to OPEN and uses the provided accountSeq", async () => {
    facade.getOrders.mockResolvedValue(page);

    const res = await ordersGET(
      req("http://localhost/api/orders?accountSeq=7"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: page });
    expect(facade.getOrders).toHaveBeenCalledWith({
      accountSeq: 7,
      status: "OPEN",
      symbol: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: undefined,
    });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
    ]);
    facade.getOrders.mockResolvedValue(page);

    const res = await ordersGET(req("http://localhost/api/orders"));

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({ accountSeq: 42, status: "OPEN" }),
    );
  });

  it("forwards an explicit status and symbol", async () => {
    facade.getOrders.mockResolvedValue(page);

    const res = await ordersGET(
      req("http://localhost/api/orders?accountSeq=1&status=OPEN&symbol=005930"),
    );

    expect(res.status).toBe(200);
    expect(facade.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OPEN", symbol: "005930" }),
    );
  });

  it("returns 400 for an invalid status", async () => {
    const res = await ordersGET(
      req("http://localhost/api/orders?accountSeq=1&status=FOO"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getOrders).not.toHaveBeenCalled();
  });

  it("forwards the upstream closed-not-supported error and sanitizes the body", async () => {
    facade.getOrders.mockRejectedValue(
      new TossApiError({
        status: 400,
        code: "closed-not-supported",
        message: "CLOSED orders are not supported",
        requestId: "req-1",
      }),
    );

    const res = await ordersGET(
      req("http://localhost/api/orders?accountSeq=1&status=CLOSED"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("closed-not-supported");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

// --- orders/{orderId} -------------------------------------------------------

describe("GET /api/orders/[orderId]", () => {
  const order = { orderId: "ord-1", symbol: "005930" };

  function detailContext(orderId: string) {
    return { params: Promise.resolve({ orderId }) };
  }

  it("forwards the orderId and provided accountSeq", async () => {
    facade.getOrder.mockResolvedValue(order);

    const res = await orderGET(
      req("http://localhost/api/orders/ord-1?accountSeq=7"),
      detailContext("ord-1"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: order });
    expect(facade.getOrder).toHaveBeenCalledWith({
      accountSeq: 7,
      orderId: "ord-1",
    });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account when accountSeq is omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
    ]);
    facade.getOrder.mockResolvedValue(order);

    const res = await orderGET(
      req("http://localhost/api/orders/ord-1"),
      detailContext("ord-1"),
    );

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getOrder).toHaveBeenCalledWith({
      accountSeq: 42,
      orderId: "ord-1",
    });
  });

  it("maps an upstream TossApiError to its status", async () => {
    facade.getOrder.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "order-not-found",
        message: "order not found",
      }),
    );

    const res = await orderGET(
      req("http://localhost/api/orders/ord-x?accountSeq=1"),
      detailContext("ord-x"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("order-not-found");
  });
});
