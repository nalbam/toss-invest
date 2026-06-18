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
  getStocks: vi.fn(),
  getStockWarnings: vi.fn(),
  getKrMarketCalendar: vi.fn(),
  getUsMarketCalendar: vi.fn(),
  getBuyingPower: vi.fn(),
  getSellableQuantity: vi.fn(),
  getCommissions: vi.fn(),
};

// Gated trading executor facade. The §6 gate itself is unit-tested in
// `lib/server/trading/safety.test.ts`; here we only verify the route forwards
// the request, the per-order `confirm`, and the assembled gate context to it
// (and never invents a confirm).
const executor = {
  placeOrder: vi.fn(),
  modifyOrder: vi.fn(),
  cancelOrder: vi.fn(),
};

vi.mock("@/lib/server/toss/container", () => ({
  getServerTossClient: () => facade,
  getServerTradingExecutor: () => executor,
}));

import { GET as accountsGET } from "@/app/api/accounts/route";
import { GET as holdingsGET } from "@/app/api/holdings/route";
import { GET as pricesGET } from "@/app/api/prices/route";
import { GET as orderbookGET } from "@/app/api/orderbook/route";
import { GET as tradesGET } from "@/app/api/trades/route";
import { GET as priceLimitsGET } from "@/app/api/price-limits/route";
import { GET as candlesGET } from "@/app/api/candles/route";
import { GET as exchangeRateGET } from "@/app/api/exchange-rate/route";
import { GET as ordersGET, POST as ordersPOST } from "@/app/api/orders/route";
import { GET as orderGET } from "@/app/api/orders/[orderId]/route";
import { POST as orderModifyPOST } from "@/app/api/orders/[orderId]/modify/route";
import { POST as orderCancelPOST } from "@/app/api/orders/[orderId]/cancel/route";
import { GET as stocksGET } from "@/app/api/stocks/route";
import { GET as stockWarningsGET } from "@/app/api/stocks/[symbol]/warnings/route";
import { GET as krCalendarGET } from "@/app/api/market-calendar/kr/route";
import { GET as usCalendarGET } from "@/app/api/market-calendar/us/route";
import { GET as buyingPowerGET } from "@/app/api/buying-power/route";
import { GET as sellableQuantityGET } from "@/app/api/sellable-quantity/route";
import { GET as commissionsGET } from "@/app/api/commissions/route";

const SECRET = "super-secret-client-secret-value";

function req(url: string): Request {
  return new Request(url);
}

function postReq(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function modifyContext(orderId: string) {
  return { params: Promise.resolve({ orderId }) };
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

// --- POST /api/orders (gated create) ----------------------------------------

describe("POST /api/orders", () => {
  const krwLimitBuy = {
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    quantity: "10",
    price: "72000",
  };

  it("forwards confirm:false to placeOrder when confirm is omitted (DRY_RUN preview)", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: krwLimitBuy,
      reasons: ["dry-run-enabled"],
    });
    facade.getBuyingPower.mockResolvedValue({
      currency: "KRW",
      cashBuyingPower: "5000000",
    });

    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", krwLimitBuy),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("DRY_RUN");
    // The route must pass confirm through as false — never auto-true it.
    expect(executor.placeOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ confirm: false }),
    );
    // KRW symbol => no exchange-rate lookup; LIMIT => no reference price.
    expect(facade.getExchangeRate).not.toHaveBeenCalled();
    expect(facade.getPrices).not.toHaveBeenCalled();
  });

  it("never coerces confirm to true (request value is forwarded verbatim)", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: krwLimitBuy,
      reasons: ["not-confirmed"],
    });
    facade.getBuyingPower.mockResolvedValue({
      currency: "KRW",
      cashBuyingPower: "5000000",
    });

    await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        ...krwLimitBuy,
        confirm: false,
      }),
    );

    expect(executor.placeOrder).toHaveBeenCalledTimes(1);
    expect(executor.placeOrder.mock.calls[0][1].confirm).toBe(false);
  });

  it("forwards confirm:true and returns SENT when the gate sends", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "SENT",
      response: { orderId: "ord-9", clientOrderId: null },
      notionalKrw: 720000,
    });
    facade.getBuyingPower.mockResolvedValue({
      currency: "KRW",
      cashBuyingPower: "5000000",
    });

    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        ...krwLimitBuy,
        confirm: true,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("SENT");
    expect(body.data.response.orderId).toBe("ord-9");
    expect(executor.placeOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ confirm: true }),
    );
  });

  it("assembles fxRate via getExchangeRate for a USD symbol", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: {},
      reasons: ["dry-run-enabled"],
    });
    facade.getExchangeRate.mockResolvedValue({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      rate: "1380.5",
    });
    facade.getBuyingPower.mockResolvedValue({
      currency: "USD",
      cashBuyingPower: "10000",
    });

    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        symbol: "AAPL",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "5",
        price: "190",
      }),
    );

    expect(res.status).toBe(200);
    expect(facade.getExchangeRate).toHaveBeenCalledWith({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
    });
    expect(executor.placeOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ fxRate: 1380.5 }),
    );
  });

  it("assembles a referencePrice via getPrices for a MARKET order", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: {},
      reasons: ["dry-run-enabled"],
    });
    facade.getPrices.mockResolvedValue([
      { symbol: "005930", lastPrice: "72000", currency: "KRW" },
    ]);
    facade.getBuyingPower.mockResolvedValue({
      currency: "KRW",
      cashBuyingPower: "5000000",
    });

    await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        symbol: "005930",
        side: "BUY",
        orderType: "MARKET",
        quantity: "10",
      }),
    );

    expect(facade.getPrices).toHaveBeenCalledWith({ symbols: ["005930"] });
    expect(executor.placeOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ referencePrice: 72000 }),
    );
  });

  it("attaches an advisory prevalidation for a SELL", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: {},
      reasons: ["dry-run-enabled"],
    });
    facade.getSellableQuantity.mockResolvedValue({ sellableQuantity: "3" });

    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        symbol: "005930",
        side: "SELL",
        orderType: "LIMIT",
        quantity: "10",
        price: "72000",
      }),
    );

    const body = await res.json();
    expect(facade.getSellableQuantity).toHaveBeenCalledWith({
      accountSeq: 7,
      symbol: "005930",
    });
    expect(body.data.prevalidation).toEqual({
      side: "SELL",
      available: "3",
      requested: "10",
      insufficient: true,
    });
  });

  it("does not block when prevalidation lookup fails", async () => {
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: {},
      reasons: ["dry-run-enabled"],
    });
    facade.getBuyingPower.mockRejectedValue(new Error("boom"));

    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", krwLimitBuy),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("DRY_RUN");
    expect(body.data.prevalidation.available).toBeNull();
    expect(body.data.prevalidation.insufficient).toBe(false);
  });

  it("returns 400 for a body that fails the order schema", async () => {
    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "10",
        // LIMIT without a price is out of contract.
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(executor.placeOrder).not.toHaveBeenCalled();
  });

  it("maps a TossApiError (409 already-filled) to 409 without leaking secrets", async () => {
    facade.getBuyingPower.mockResolvedValue({
      currency: "KRW",
      cashBuyingPower: "5000000",
    });
    executor.placeOrder.mockRejectedValue(
      new TossApiError({
        status: 409,
        code: "already-filled",
        message: "order already filled",
        requestId: "req-1",
      }),
    );

    const res = await ordersPOST(
      postReq("http://localhost/api/orders?accountSeq=7", {
        ...krwLimitBuy,
        confirm: true,
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("already-filled");
    expect(body.error.requestId).toBe("req-1");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
    ]);
    facade.getBuyingPower.mockResolvedValue({
      currency: "KRW",
      cashBuyingPower: "5000000",
    });
    executor.placeOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: krwLimitBuy,
      reasons: ["dry-run-enabled"],
    });

    const res = await ordersPOST(
      postReq("http://localhost/api/orders", krwLimitBuy),
    );

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(executor.placeOrder).toHaveBeenCalledWith(42, expect.anything());
  });
});

// --- POST /api/orders/[orderId]/modify (gated modify) -----------------------

describe("POST /api/orders/[orderId]/modify", () => {
  const limitModify = { orderType: "LIMIT", quantity: "5", price: "73000" };

  it("assembles symbol/originalQuantity via getOrder and forwards them", async () => {
    facade.getOrder.mockResolvedValue({
      orderId: "ord-1",
      symbol: "005930",
      quantity: "10",
    });
    executor.modifyOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: limitModify,
      reasons: ["dry-run-enabled"],
    });

    const res = await orderModifyPOST(
      postReq("http://localhost/api/orders/ord-1/modify?accountSeq=7", {
        ...limitModify,
        confirm: true,
      }),
      modifyContext("ord-1"),
    );

    expect(res.status).toBe(200);
    expect(facade.getOrder).toHaveBeenCalledWith({
      accountSeq: 7,
      orderId: "ord-1",
    });
    expect(executor.modifyOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        orderId: "ord-1",
        symbol: "005930",
        originalQuantity: 10,
        confirm: true,
      }),
    );
  });

  it("forwards confirm:false when omitted", async () => {
    facade.getOrder.mockResolvedValue({
      orderId: "ord-1",
      symbol: "005930",
      quantity: "10",
    });
    executor.modifyOrder.mockResolvedValue({
      status: "DRY_RUN",
      wouldSend: limitModify,
      reasons: ["dry-run-enabled"],
    });

    await orderModifyPOST(
      postReq("http://localhost/api/orders/ord-1/modify?accountSeq=7", limitModify),
      modifyContext("ord-1"),
    );

    expect(executor.modifyOrder.mock.calls[0][1].confirm).toBe(false);
  });

  it("returns 400 for a modify body that fails the schema", async () => {
    const res = await orderModifyPOST(
      postReq("http://localhost/api/orders/ord-1/modify?accountSeq=7", {
        orderType: "MARKET",
        price: "73000", // MARKET must not carry a price.
      }),
      modifyContext("ord-1"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(executor.modifyOrder).not.toHaveBeenCalled();
  });

  it("maps a TossApiError to its status", async () => {
    facade.getOrder.mockResolvedValue({
      orderId: "ord-1",
      symbol: "005930",
      quantity: "10",
    });
    executor.modifyOrder.mockRejectedValue(
      new TossApiError({
        status: 409,
        code: "already-canceled",
        message: "order already canceled",
      }),
    );

    const res = await orderModifyPOST(
      postReq("http://localhost/api/orders/ord-1/modify?accountSeq=7", {
        ...limitModify,
        confirm: true,
      }),
      modifyContext("ord-1"),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("already-canceled");
  });
});

// --- POST /api/orders/[orderId]/cancel (gated cancel) -----------------------

describe("POST /api/orders/[orderId]/cancel", () => {
  it("forwards the orderId and confirm to cancelOrder", async () => {
    executor.cancelOrder.mockResolvedValue({
      status: "DRY_RUN",
      orderId: "ord-1",
      reasons: ["dry-run-enabled"],
    });

    const res = await orderCancelPOST(
      postReq("http://localhost/api/orders/ord-1/cancel?accountSeq=7", {
        confirm: true,
      }),
      modifyContext("ord-1"),
    );

    expect(res.status).toBe(200);
    expect(executor.cancelOrder).toHaveBeenCalledWith(7, {
      orderId: "ord-1",
      confirm: true,
    });
  });

  it("accepts an empty body and defaults confirm to false", async () => {
    executor.cancelOrder.mockResolvedValue({
      status: "DRY_RUN",
      orderId: "ord-1",
      reasons: ["not-confirmed"],
    });

    const res = await orderCancelPOST(
      postReq("http://localhost/api/orders/ord-1/cancel?accountSeq=7"),
      modifyContext("ord-1"),
    );

    expect(res.status).toBe(200);
    expect(executor.cancelOrder).toHaveBeenCalledWith(7, {
      orderId: "ord-1",
      confirm: false,
    });
  });

  it("maps a TossApiError to its status", async () => {
    executor.cancelOrder.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "order-not-found",
        message: "order not found",
      }),
    );

    const res = await orderCancelPOST(
      postReq("http://localhost/api/orders/ord-x/cancel?accountSeq=7", {
        confirm: true,
      }),
      modifyContext("ord-x"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("order-not-found");
  });
});

// --- stocks -----------------------------------------------------------------

describe("GET /api/stocks", () => {
  it("splits symbols into an array and returns 200", async () => {
    const stocks = [{ symbol: "005930", name: "삼성전자" }];
    facade.getStocks.mockResolvedValue(stocks);

    const res = await stocksGET(
      req("http://localhost/api/stocks?symbols=005930,000660"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: stocks });
    expect(facade.getStocks).toHaveBeenCalledWith({
      symbols: ["005930", "000660"],
    });
  });

  it("returns 400 when symbols is missing", async () => {
    const res = await stocksGET(req("http://localhost/api/stocks"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getStocks).not.toHaveBeenCalled();
  });

  it("maps an unknown error to a generic 500 without leaking secrets", async () => {
    facade.getStocks.mockRejectedValue(new Error(`boom containing ${SECRET}`));

    const res = await stocksGET(
      req("http://localhost/api/stocks?symbols=005930"),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal-error");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

// --- stocks/{symbol}/warnings -----------------------------------------------

describe("GET /api/stocks/[symbol]/warnings", () => {
  const warnings = [{ warningType: "VI_STATIC", exchange: "KRX" }];

  function warningsContext(symbol: string) {
    return { params: Promise.resolve({ symbol }) };
  }

  it("forwards the path symbol and returns 200", async () => {
    facade.getStockWarnings.mockResolvedValue(warnings);

    const res = await stockWarningsGET(
      req("http://localhost/api/stocks/005930/warnings"),
      warningsContext("005930"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: warnings });
    expect(facade.getStockWarnings).toHaveBeenCalledWith({ symbol: "005930" });
  });

  it("maps an upstream TossApiError to its status", async () => {
    facade.getStockWarnings.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "symbol-not-found",
        message: "symbol not found",
      }),
    );

    const res = await stockWarningsGET(
      req("http://localhost/api/stocks/XXXX/warnings"),
      warningsContext("XXXX"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("symbol-not-found");
  });
});

// --- market-calendar/KR -----------------------------------------------------

describe("GET /api/market-calendar/kr", () => {
  const calendar = { today: { date: "2026-03-25" } };

  it("returns 200 and omits date when not provided", async () => {
    facade.getKrMarketCalendar.mockResolvedValue(calendar);

    const res = await krCalendarGET(
      req("http://localhost/api/market-calendar/kr"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: calendar });
    expect(facade.getKrMarketCalendar).toHaveBeenCalledWith({
      date: undefined,
    });
  });

  it("forwards the date query", async () => {
    facade.getKrMarketCalendar.mockResolvedValue(calendar);

    const res = await krCalendarGET(
      req("http://localhost/api/market-calendar/kr?date=2026-03-21"),
    );

    expect(res.status).toBe(200);
    expect(facade.getKrMarketCalendar).toHaveBeenCalledWith({
      date: "2026-03-21",
    });
  });
});

// --- market-calendar/US -----------------------------------------------------

describe("GET /api/market-calendar/us", () => {
  const calendar = { today: { date: "2026-03-25" } };

  it("returns 200 and forwards the date query", async () => {
    facade.getUsMarketCalendar.mockResolvedValue(calendar);

    const res = await usCalendarGET(
      req("http://localhost/api/market-calendar/us?date=2026-12-25"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: calendar });
    expect(facade.getUsMarketCalendar).toHaveBeenCalledWith({
      date: "2026-12-25",
    });
  });
});

// --- buying-power -----------------------------------------------------------

describe("GET /api/buying-power", () => {
  const power = { currency: "KRW", cashBuyingPower: "5000000" };

  it("uses the provided accountSeq and forwards the currency", async () => {
    facade.getBuyingPower.mockResolvedValue(power);

    const res = await buyingPowerGET(
      req("http://localhost/api/buying-power?accountSeq=7&currency=KRW"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: power });
    expect(facade.getBuyingPower).toHaveBeenCalledWith({
      accountSeq: 7,
      currency: "KRW",
    });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
    ]);
    facade.getBuyingPower.mockResolvedValue(power);

    const res = await buyingPowerGET(
      req("http://localhost/api/buying-power?currency=USD"),
    );

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getBuyingPower).toHaveBeenCalledWith({
      accountSeq: 42,
      currency: "USD",
    });
  });

  it("returns 400 when currency is missing", async () => {
    const res = await buyingPowerGET(
      req("http://localhost/api/buying-power?accountSeq=7"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getBuyingPower).not.toHaveBeenCalled();
  });
});

// --- sellable-quantity ------------------------------------------------------

describe("GET /api/sellable-quantity", () => {
  const sellable = { sellableQuantity: "100" };

  it("uses the provided accountSeq and forwards the symbol", async () => {
    facade.getSellableQuantity.mockResolvedValue(sellable);

    const res = await sellableQuantityGET(
      req("http://localhost/api/sellable-quantity?accountSeq=3&symbol=005930"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: sellable });
    expect(facade.getSellableQuantity).toHaveBeenCalledWith({
      accountSeq: 3,
      symbol: "005930",
    });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
    ]);
    facade.getSellableQuantity.mockResolvedValue(sellable);

    const res = await sellableQuantityGET(
      req("http://localhost/api/sellable-quantity?symbol=AAPL"),
    );

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getSellableQuantity).toHaveBeenCalledWith({
      accountSeq: 42,
      symbol: "AAPL",
    });
  });

  it("returns 400 when symbol is missing", async () => {
    const res = await sellableQuantityGET(
      req("http://localhost/api/sellable-quantity?accountSeq=3"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getSellableQuantity).not.toHaveBeenCalled();
  });
});

// --- commissions ------------------------------------------------------------

describe("GET /api/commissions", () => {
  const commissions = [{ marketCountry: "KR", commissionRate: "0.015" }];

  it("uses the provided accountSeq and returns 200", async () => {
    facade.getCommissions.mockResolvedValue(commissions);

    const res = await commissionsGET(
      req("http://localhost/api/commissions?accountSeq=1"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: commissions });
    expect(facade.getCommissions).toHaveBeenCalledWith({ accountSeq: 1 });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
    ]);
    facade.getCommissions.mockResolvedValue(commissions);

    const res = await commissionsGET(req("http://localhost/api/commissions"));

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getCommissions).toHaveBeenCalledWith({ accountSeq: 42 });
  });

  it("returns 400 for a non-integer accountSeq", async () => {
    const res = await commissionsGET(
      req("http://localhost/api/commissions?accountSeq=abc"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getCommissions).not.toHaveBeenCalled();
  });
});
