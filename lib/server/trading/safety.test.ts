import { describe, expect, it, vi } from "vitest";
import {
  orderCreateQuantityBasedSchema,
  orderCreateRequestSchema,
  type OrderCreateRequest,
} from "@/lib/server/toss/schemas";
import {
  evaluateOrderGate,
  placeOrder,
  type AuditLogger,
  type CreateOrderRawFn,
  type OrderGateContext,
  type TradingConfig,
} from "@/lib/server/trading/safety";

// --- fixtures ---------------------------------------------------------------

/** A KRW limit buy whose notional (10 * 70000 = 700,000 KRW) is well below 1억. */
const limitBuy: OrderCreateRequest = {
  symbol: "005930",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  quantity: "10",
  price: "70000",
  confirmHighValueOrder: false,
};

/** Config with DRY_RUN off and a generous limit: real orders are *possible*. */
function liveConfig(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    dryRun: false,
    killSwitch: false,
    maxOrderAmount: 100_000_000,
    dailyLossLimit: undefined,
    ...overrides,
  };
}

interface Harness {
  createOrderRaw: ReturnType<typeof vi.fn>;
  auditLog: ReturnType<typeof vi.fn>;
  now: () => number;
}

function harness(): Harness & {
  createOrderRawFn: CreateOrderRawFn;
  auditLogger: AuditLogger;
} {
  const createOrderRaw = vi.fn(async () => ({
    orderId: "srv-order-1",
    clientOrderId: null,
  }));
  const auditLog = vi.fn(() => {});
  const now = () => 1_700_000_000_000;
  return {
    createOrderRaw,
    auditLog,
    now,
    createOrderRawFn: createOrderRaw as unknown as CreateOrderRawFn,
    auditLogger: auditLog as unknown as AuditLogger,
  };
}

function baseCtx(overrides: Partial<OrderGateContext> = {}): OrderGateContext {
  return {
    config: liveConfig(),
    confirm: true,
    accountSeq: 789,
    ...overrides,
  };
}

// --- evaluateOrderGate (pure) -----------------------------------------------

describe("evaluateOrderGate", () => {
  it("KILL_SWITCH on => BLOCK (even with confirm + DRY_RUN off)", () => {
    const result = evaluateOrderGate(limitBuy, {
      config: liveConfig({ killSwitch: true }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("kill-switch-on");
  });

  it("notional over MAX_ORDER_AMOUNT => BLOCK", () => {
    // 10 * 70000 = 700,000 > 500,000 limit
    const result = evaluateOrderGate(limitBuy, {
      config: liveConfig({ maxOrderAmount: 500_000 }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("max-order-amount-exceeded");
  });

  it("MAX_ORDER_AMOUNT unset => BLOCK (no real orders allowed)", () => {
    const result = evaluateOrderGate(limitBuy, {
      config: liveConfig({ maxOrderAmount: undefined }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("max-order-amount-unset");
  });

  it("high-value (>=1억) without confirmHighValueOrder => BLOCK", () => {
    // 2 * 60,000,000 = 120,000,000 >= 1억
    const highValue: OrderCreateRequest = {
      ...limitBuy,
      quantity: "2",
      price: "60000000",
      confirmHighValueOrder: false,
    };
    const result = evaluateOrderGate(highValue, {
      config: liveConfig({ maxOrderAmount: 200_000_000 }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.highValue).toBe(true);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("high-value-not-confirmed");
  });

  it("MARKET quantity-based with unknown price (no referencePrice) => BLOCK", () => {
    const marketQty: OrderCreateRequest = {
      symbol: "005930",
      side: "BUY",
      orderType: "MARKET",
      timeInForce: "DAY",
      quantity: "10",
      confirmHighValueOrder: false,
    };
    const result = evaluateOrderGate(marketQty, baseCtx());
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("notional-unknown");
  });

  it("DRY_RUN default (true) => DRY_RUN", () => {
    const result = evaluateOrderGate(limitBuy, baseCtx({ config: liveConfig({ dryRun: true }) }));
    expect(result.decision).toBe("DRY_RUN");
  });

  it("DRY_RUN off but no confirm => DRY_RUN", () => {
    const result = evaluateOrderGate(limitBuy, baseCtx({ confirm: false }));
    expect(result.decision).toBe("DRY_RUN");
  });

  it("DRY_RUN off + confirm + within limit + kill off => SEND", () => {
    const result = evaluateOrderGate(limitBuy, baseCtx());
    expect(result.decision).toBe("SEND");
    expect(result.notionalKrw).toBe(700_000);
    expect(result.highValue).toBe(false);
  });

  it("AmountBased USD converts via fxRate for notional", () => {
    const amountOrder: OrderCreateRequest = {
      symbol: "AAPL",
      side: "BUY",
      orderType: "MARKET",
      orderAmount: "1000",
      confirmHighValueOrder: false,
    };
    // 1000 USD * 1300 = 1,300,000 KRW
    const result = evaluateOrderGate(amountOrder, baseCtx({ fxRate: 1300 }));
    expect(result.notionalKrw).toBe(1_300_000);
    expect(result.decision).toBe("SEND");
  });

  it("AmountBased USD without fxRate => BLOCK (notional unknown)", () => {
    const amountOrder: OrderCreateRequest = {
      symbol: "AAPL",
      side: "BUY",
      orderType: "MARKET",
      orderAmount: "1000",
      confirmHighValueOrder: false,
    };
    const result = evaluateOrderGate(amountOrder, baseCtx());
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("notional-unknown");
  });

  it("US LIMIT (USD price) over limit once converted via fxRate => BLOCK", () => {
    // AAPL LIMIT 100 @ $200 = $20,000; * 1380 = 27,600,000 KRW > 5,000,000 limit.
    // Without currency-aware notional this would be mis-valued as 20,000 KRW and
    // wrongly pass — the fail-unsafe regression this test guards against.
    const usLimit: OrderCreateRequest = {
      symbol: "AAPL",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: "100",
      price: "200",
      confirmHighValueOrder: false,
    };
    const result = evaluateOrderGate(
      usLimit,
      baseCtx({ fxRate: 1380, config: liveConfig({ maxOrderAmount: 5_000_000 }) }),
    );
    expect(result.notionalKrw).toBe(27_600_000);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("max-order-amount-exceeded");
  });

  it("US LIMIT (USD) without fxRate => BLOCK (notional unknown, fail-safe)", () => {
    const usLimit: OrderCreateRequest = {
      symbol: "AAPL",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: "1",
      price: "200",
      confirmHighValueOrder: false,
    };
    const result = evaluateOrderGate(usLimit, baseCtx());
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("notional-unknown");
  });

  it("US LIMIT (USD) within limit converts via fxRate => SEND", () => {
    // 1 * $100 * 1380 = 138,000 KRW, within the default 1억 limit.
    const usLimit: OrderCreateRequest = {
      symbol: "AAPL",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: "1",
      price: "100",
      confirmHighValueOrder: false,
    };
    const result = evaluateOrderGate(usLimit, baseCtx({ fxRate: 1380 }));
    expect(result.notionalKrw).toBe(138_000);
    expect(result.decision).toBe("SEND");
  });
});

// --- placeOrder (executor) --------------------------------------------------

describe("placeOrder", () => {
  it("DRY_RUN default (env unset) => DRY_RUN, createOrderRaw NOT called", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig({ dryRun: true }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("DRY_RUN");
    if (result.status === "DRY_RUN") {
      expect(result.wouldSend).toEqual(limitBuy);
    }
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("DRY_RUN off + no confirm => DRY_RUN, createOrderRaw NOT called", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: false },
      {
        config: liveConfig(),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("DRY_RUN");
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("DRY_RUN off + confirm + within limit + kill off => SEND, createOrderRaw called once", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig(),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("SENT");
    expect(h.createOrderRaw).toHaveBeenCalledTimes(1);
    expect(h.createOrderRaw).toHaveBeenCalledWith({
      accountSeq: 789,
      body: limitBuy,
    });
  });

  it("high-value with confirmHighValueOrder=true => SEND", async () => {
    const h = harness();
    const highValueConfirmed: OrderCreateRequest = {
      ...limitBuy,
      quantity: "2",
      price: "60000000",
      confirmHighValueOrder: true,
    };
    const result = await placeOrder(
      { request: highValueConfirmed, confirm: true },
      {
        config: liveConfig({ maxOrderAmount: 200_000_000 }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("SENT");
    expect(h.createOrderRaw).toHaveBeenCalledTimes(1);
  });

  it("KILL_SWITCH on => BLOCK, createOrderRaw NOT called (confirm + DRY_RUN off)", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig({ killSwitch: true }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("notional over MAX_ORDER_AMOUNT => BLOCK, createOrderRaw NOT called", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig({ maxOrderAmount: 500_000 }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("MAX_ORDER_AMOUNT unset => BLOCK, createOrderRaw NOT called", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig({ maxOrderAmount: undefined }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("high-value without confirmHighValueOrder => BLOCK, createOrderRaw NOT called", async () => {
    const h = harness();
    const highValue: OrderCreateRequest = {
      ...limitBuy,
      quantity: "2",
      price: "60000000",
      confirmHighValueOrder: false,
    };
    const result = await placeOrder(
      { request: highValue, confirm: true },
      {
        config: liveConfig({ maxOrderAmount: 200_000_000 }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("MARKET quantity-based (price unknown, no referencePrice) => BLOCK, createOrderRaw NOT called", async () => {
    const h = harness();
    const marketQty: OrderCreateRequest = {
      symbol: "005930",
      side: "BUY",
      orderType: "MARKET",
      timeInForce: "DAY",
      quantity: "10",
      confirmHighValueOrder: false,
    };
    const result = await placeOrder(
      { request: marketQty, confirm: true },
      {
        config: liveConfig(),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("dry-run does NOT consume/mint clientOrderId (preserved as given)", async () => {
    const h = harness();
    const withClientId: OrderCreateRequest = {
      ...limitBuy,
      clientOrderId: "my-order-001",
    };
    const result = await placeOrder(
      { request: withClientId, confirm: true },
      {
        config: liveConfig({ dryRun: true }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("DRY_RUN");
    if (result.status === "DRY_RUN") {
      // Preserved verbatim, not mutated, not minted.
      expect(result.wouldSend.clientOrderId).toBe("my-order-001");
    }
    expect(h.createOrderRaw).not.toHaveBeenCalled();
  });

  it("BLOCK does NOT mint a clientOrderId for a request without one", async () => {
    const h = harness();
    const result = await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig({ killSwitch: true }),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.request.clientOrderId).toBeUndefined();
    }
  });

  it("audit log records each decision (SEND / DRY_RUN / BLOCK)", async () => {
    const send = harness();
    await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig(),
        createOrderRaw: send.createOrderRawFn,
        now: send.now,
        auditLog: send.auditLogger,
        accountSeq: 789,
      },
    );
    expect(send.auditLog).toHaveBeenCalledTimes(1);
    expect(send.auditLog.mock.calls[0]?.[0]).toMatchObject({
      decision: "SEND",
    });

    const dry = harness();
    await placeOrder(
      { request: limitBuy, confirm: false },
      {
        config: liveConfig(),
        createOrderRaw: dry.createOrderRawFn,
        now: dry.now,
        auditLog: dry.auditLogger,
        accountSeq: 789,
      },
    );
    expect(dry.auditLog.mock.calls[0]?.[0]).toMatchObject({
      decision: "DRY_RUN",
    });

    const block = harness();
    await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig({ killSwitch: true }),
        createOrderRaw: block.createOrderRawFn,
        now: block.now,
        auditLog: block.auditLogger,
        accountSeq: 789,
      },
    );
    expect(block.auditLog.mock.calls[0]?.[0]).toMatchObject({
      decision: "BLOCK",
    });
  });

  it("audit log excludes secrets/PII (no token/account secret in entry)", async () => {
    const h = harness();
    await placeOrder(
      { request: limitBuy, confirm: true },
      {
        config: liveConfig(),
        createOrderRaw: h.createOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    const entry = JSON.stringify(h.auditLog.mock.calls[0]?.[0]);
    // The audit entry summarizes the order, never carrying auth material.
    expect(entry).not.toMatch(/Bearer/);
    expect(entry).not.toMatch(/secret/i);
  });
});

// --- schema validation ------------------------------------------------------

describe("orderCreateRequestSchema", () => {
  it("accepts a valid quantity-based LIMIT order with price", () => {
    const parsed = orderCreateRequestSchema.parse({
      symbol: "005930",
      side: "BUY",
      orderType: "LIMIT",
      quantity: "10",
      price: "70000",
    });
    expect(parsed).toMatchObject({ orderType: "LIMIT", price: "70000" });
  });

  it("rejects a LIMIT order missing price", () => {
    const result = orderCreateQuantityBasedSchema.safeParse({
      symbol: "005930",
      side: "BUY",
      orderType: "LIMIT",
      quantity: "10",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a MARKET quantity-based order carrying price", () => {
    const result = orderCreateQuantityBasedSchema.safeParse({
      symbol: "005930",
      side: "BUY",
      orderType: "MARKET",
      quantity: "10",
      price: "70000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional (non-integer) quantity", () => {
    const result = orderCreateQuantityBasedSchema.safeParse({
      symbol: "005930",
      side: "BUY",
      orderType: "MARKET",
      quantity: "10.5",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an amount-based US MARKET order", () => {
    const parsed = orderCreateRequestSchema.parse({
      symbol: "AAPL",
      side: "BUY",
      orderType: "MARKET",
      orderAmount: "100.5",
    });
    expect(parsed).toMatchObject({ orderType: "MARKET", orderAmount: "100.5" });
  });

  it("rejects a clientOrderId with disallowed characters", () => {
    const result = orderCreateQuantityBasedSchema.safeParse({
      clientOrderId: "bad id!",
      symbol: "005930",
      side: "BUY",
      orderType: "MARKET",
      quantity: "10",
    });
    expect(result.success).toBe(false);
  });
});
