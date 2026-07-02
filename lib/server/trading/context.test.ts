import { describe, expect, it, vi } from "vitest";
import {
  assembleCreateContext,
  assembleModifyContext,
} from "@/lib/server/trading/context";
import type { ServerTossClient } from "@/lib/server/toss/container";
import type {
  OrderCreateRequest,
  OrderModifyRequest,
} from "@/lib/server/toss/schemas";

// --- client stub ------------------------------------------------------------

interface ClientMock {
  getExchangeRate: ReturnType<typeof vi.fn>;
  getPrices: ReturnType<typeof vi.fn>;
  getOrder: ReturnType<typeof vi.fn>;
  client: ServerTossClient;
}

/**
 * Builds a `ServerTossClient` stub whose only wired methods are the three the
 * context builder reads (getExchangeRate / getPrices / getOrder), each a `vi.fn`
 * spy so a test can drive success/failure and assert whether a lookup was even
 * reached. Every other method is intentionally absent — context.ts must never
 * touch them — and the object is cast to the full facade type.
 */
function makeClient(): ClientMock {
  const getExchangeRate = vi.fn();
  const getPrices = vi.fn();
  const getOrder = vi.fn();
  const client = {
    getExchangeRate,
    getPrices,
    getOrder,
  } as unknown as ServerTossClient;
  return { getExchangeRate, getPrices, getOrder, client };
}

// --- create fixtures --------------------------------------------------------

/** KRW LIMIT: native currency (no fx) and carries its own price (no reference). */
const krwLimit: OrderCreateRequest = {
  symbol: "005930",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  quantity: "10",
  price: "70000",
  confirmHighValueOrder: false,
};

/** KRW MARKET quantity-based: no fx, needs a reference price to be valued. */
const krwMarket: OrderCreateRequest = {
  symbol: "005930",
  side: "SELL",
  orderType: "MARKET",
  timeInForce: "DAY",
  quantity: "10",
  confirmHighValueOrder: false,
};

/** USD LIMIT: needs an fx rate, carries its own price (no reference). */
const usdLimit: OrderCreateRequest = {
  symbol: "AAPL",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  quantity: "5",
  price: "200",
  confirmHighValueOrder: false,
};

/** USD amount-based MARKET: valued from `orderAmount`, so no reference price. */
const usdAmount: OrderCreateRequest = {
  symbol: "AAPL",
  side: "BUY",
  orderType: "MARKET",
  orderAmount: "1000",
  confirmHighValueOrder: false,
};

// --- assembleCreateContext: fxRate ------------------------------------------

describe("assembleCreateContext — fxRate", () => {
  it("KRW symbol => fxRate undefined and getExchangeRate is never called", async () => {
    const m = makeClient();
    const ctx = await assembleCreateContext(m.client, krwLimit);
    expect(ctx.fxRate).toBeUndefined();
    expect(m.getExchangeRate).not.toHaveBeenCalled();
  });

  it("USD symbol with a finite rate => fxRate is that rate", async () => {
    const m = makeClient();
    m.getExchangeRate.mockResolvedValue({ rate: "1380" });
    const ctx = await assembleCreateContext(m.client, usdLimit);
    expect(ctx.fxRate).toBe(1380);
    expect(m.getExchangeRate).toHaveBeenCalledWith({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
    });
  });

  it("USD symbol, getExchangeRate throws => fxRate undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getExchangeRate.mockRejectedValue(new Error("rate lookup failed"));
    const ctx = await assembleCreateContext(m.client, usdLimit);
    expect(ctx.fxRate).toBeUndefined();
  });

  it.each(["abc", "NaN"])(
    "USD symbol, non-finite rate (%s) => fxRate undefined (fail-safe)",
    async (rate) => {
      const m = makeClient();
      m.getExchangeRate.mockResolvedValue({ rate });
      const ctx = await assembleCreateContext(m.client, usdLimit);
      expect(ctx.fxRate).toBeUndefined();
    },
  );
});

// --- assembleCreateContext: referencePrice ----------------------------------

describe("assembleCreateContext — referencePrice", () => {
  it("MARKET order => referencePrice resolved from getPrices (matching symbol)", async () => {
    const m = makeClient();
    m.getPrices.mockResolvedValue([{ symbol: "005930", lastPrice: "70000" }]);
    const ctx = await assembleCreateContext(m.client, krwMarket);
    expect(ctx.referencePrice).toBe(70000);
    expect(m.getPrices).toHaveBeenCalledWith({ symbols: ["005930"] });
  });

  it("MARKET order, getPrices throws => referencePrice undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getPrices.mockRejectedValue(new Error("price lookup failed"));
    const ctx = await assembleCreateContext(m.client, krwMarket);
    expect(ctx.referencePrice).toBeUndefined();
  });

  it("MARKET order, no price row available => referencePrice undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getPrices.mockResolvedValue([]);
    const ctx = await assembleCreateContext(m.client, krwMarket);
    expect(ctx.referencePrice).toBeUndefined();
  });

  it("MARKET order, non-finite lastPrice => referencePrice undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getPrices.mockResolvedValue([{ symbol: "005930", lastPrice: "unknown" }]);
    const ctx = await assembleCreateContext(m.client, krwMarket);
    expect(ctx.referencePrice).toBeUndefined();
  });

  it("LIMIT order => referencePrice undefined and getPrices is never called", async () => {
    const m = makeClient();
    const ctx = await assembleCreateContext(m.client, krwLimit);
    expect(ctx.referencePrice).toBeUndefined();
    expect(m.getPrices).not.toHaveBeenCalled();
  });

  it("amount-based (orderAmount) order => referencePrice undefined and getPrices is never called", async () => {
    const m = makeClient();
    m.getExchangeRate.mockResolvedValue({ rate: "1380" });
    const ctx = await assembleCreateContext(m.client, usdAmount);
    expect(ctx.referencePrice).toBeUndefined();
    expect(m.getPrices).not.toHaveBeenCalled();
  });
});

// --- modify fixtures --------------------------------------------------------

/** KR LIMIT modify: carries a price + quantity, so no reference price is needed. */
const krLimitModify: OrderModifyRequest = {
  orderType: "LIMIT",
  quantity: "15",
  price: "71000",
  confirmHighValueOrder: false,
};

/** MARKET modify: no price, so a reference price must be resolved. */
const marketModify: OrderModifyRequest = {
  orderType: "MARKET",
  confirmHighValueOrder: false,
};

// --- assembleModifyContext --------------------------------------------------

describe("assembleModifyContext — originalQuantity + symbol", () => {
  it("returns the original order's symbol and a finite originalQuantity", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "005930", quantity: "10" });
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.symbol).toBe("005930");
    expect(ctx.originalQuantity).toBe(10);
    expect(m.getOrder).toHaveBeenCalledWith({ accountSeq: 789, orderId: "ord-1" });
  });

  it("non-finite original quantity => originalQuantity undefined (fail-safe), symbol still returned", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "005930", quantity: "unknown" });
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.symbol).toBe("005930");
    expect(ctx.originalQuantity).toBeUndefined();
  });
});

describe("assembleModifyContext — fxRate (keyed off the original symbol)", () => {
  it("KRW original symbol => fxRate undefined and getExchangeRate is never called", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "005930", quantity: "10" });
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.fxRate).toBeUndefined();
    expect(m.getExchangeRate).not.toHaveBeenCalled();
  });

  it("USD original symbol with a finite rate => fxRate is that rate", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "AAPL", quantity: "10" });
    m.getExchangeRate.mockResolvedValue({ rate: "1380" });
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.fxRate).toBe(1380);
  });

  it("USD original symbol, getExchangeRate throws => fxRate undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "AAPL", quantity: "10" });
    m.getExchangeRate.mockRejectedValue(new Error("rate lookup failed"));
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.fxRate).toBeUndefined();
  });

  it("USD original symbol, non-finite rate => fxRate undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "AAPL", quantity: "10" });
    m.getExchangeRate.mockResolvedValue({ rate: "abc" });
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.fxRate).toBeUndefined();
  });
});

describe("assembleModifyContext — referencePrice", () => {
  it("LIMIT modify => referencePrice undefined and getPrices is never called", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "005930", quantity: "10" });
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", krLimitModify);
    expect(ctx.referencePrice).toBeUndefined();
    expect(m.getPrices).not.toHaveBeenCalled();
  });

  it("MARKET modify => referencePrice resolved from getPrices on the original symbol", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "005930", quantity: "10" });
    m.getPrices.mockResolvedValue([{ symbol: "005930", lastPrice: "70000" }]);
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", marketModify);
    expect(ctx.referencePrice).toBe(70000);
    expect(m.getPrices).toHaveBeenCalledWith({ symbols: ["005930"] });
  });

  it("MARKET modify, getPrices throws => referencePrice undefined (fail-safe)", async () => {
    const m = makeClient();
    m.getOrder.mockResolvedValue({ symbol: "005930", quantity: "10" });
    m.getPrices.mockRejectedValue(new Error("price lookup failed"));
    const ctx = await assembleModifyContext(m.client, 789, "ord-1", marketModify);
    expect(ctx.referencePrice).toBeUndefined();
  });
});
