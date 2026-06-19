import { describe, expect, it, vi } from "vitest";
import {
  orderCreateQuantityBasedSchema,
  orderCreateRequestSchema,
  orderModifyRequestSchema,
  type OrderCreateRequest,
  type OrderModifyRequest,
} from "@/lib/server/toss/schemas";
import {
  cancelOrder,
  evaluateCancelGate,
  evaluateModifyGate,
  evaluateOrderGate,
  modifyOrder,
  placeOrder,
  type AuditLogger,
  type CancelOrderRawFn,
  type CreateOrderRawFn,
  type ModifyOrderRawFn,
  type OrderGateContext,
  type OrderOpAuditLogger,
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

// === modify / cancel ========================================================

// --- modify fixtures --------------------------------------------------------

/** A KR LIMIT modify whose notional (15 * 71000 = 1,065,000 KRW) is below 1억. */
const krLimitModify: OrderModifyRequest = {
  orderType: "LIMIT",
  quantity: "15",
  price: "71000",
  confirmHighValueOrder: false,
};

interface OpHarness {
  modifyOrderRaw: ReturnType<typeof vi.fn>;
  cancelOrderRaw: ReturnType<typeof vi.fn>;
  auditLog: ReturnType<typeof vi.fn>;
  now: () => number;
}

function opHarness(): OpHarness & {
  modifyOrderRawFn: ModifyOrderRawFn;
  cancelOrderRawFn: CancelOrderRawFn;
  auditLogger: OrderOpAuditLogger;
} {
  const modifyOrderRaw = vi.fn(async () => ({ orderId: "srv-modify-1" }));
  const cancelOrderRaw = vi.fn(async () => ({ orderId: "srv-cancel-1" }));
  const auditLog = vi.fn(() => {});
  const now = () => 1_700_000_000_000;
  return {
    modifyOrderRaw,
    cancelOrderRaw,
    auditLog,
    now,
    modifyOrderRawFn: modifyOrderRaw as unknown as ModifyOrderRawFn,
    cancelOrderRawFn: cancelOrderRaw as unknown as CancelOrderRawFn,
    auditLogger: auditLog as unknown as OrderOpAuditLogger,
  };
}

// --- evaluateModifyGate (pure) ----------------------------------------------

describe("evaluateModifyGate", () => {
  it("DRY_RUN default (true) => DRY_RUN", () => {
    const result = evaluateModifyGate(krLimitModify, "005930", {
      config: liveConfig({ dryRun: true }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("DRY_RUN");
    expect(result.notionalKrw).toBe(1_065_000);
  });

  it("KR LIMIT new notional over MAX_ORDER_AMOUNT => BLOCK", () => {
    // 15 * 71000 = 1,065,000 > 1,000,000 limit
    const result = evaluateModifyGate(krLimitModify, "005930", {
      config: liveConfig({ maxOrderAmount: 1_000_000 }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("max-order-amount-exceeded");
  });

  it("US LIMIT new notional over limit once converted via fxRate => BLOCK", () => {
    // AAPL LIMIT 100 @ $200 = $20,000; * 1380 = 27,600,000 KRW > 5,000,000 limit.
    const usModify: OrderModifyRequest = {
      orderType: "LIMIT",
      quantity: "100",
      price: "200",
      confirmHighValueOrder: false,
    };
    const result = evaluateModifyGate(usModify, "AAPL", {
      config: liveConfig({ maxOrderAmount: 5_000_000 }),
      confirm: true,
      accountSeq: 789,
      fxRate: 1380,
    });
    expect(result.notionalKrw).toBe(27_600_000);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("max-order-amount-exceeded");
  });

  it("US LIMIT without fxRate => BLOCK (notional unknown, fail-safe)", () => {
    const usModify: OrderModifyRequest = {
      orderType: "LIMIT",
      quantity: "1",
      price: "200",
      confirmHighValueOrder: false,
    };
    const result = evaluateModifyGate(usModify, "AAPL", {
      config: liveConfig(),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("notional-unknown");
  });

  it("re-valued high-value (>=1억) without confirmHighValueOrder => BLOCK", () => {
    // 2 * 60,000,000 = 120,000,000 >= 1억
    const highValueModify: OrderModifyRequest = {
      orderType: "LIMIT",
      quantity: "2",
      price: "60000000",
      confirmHighValueOrder: false,
    };
    const result = evaluateModifyGate(highValueModify, "005930", {
      config: liveConfig({ maxOrderAmount: 200_000_000 }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.highValue).toBe(true);
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("high-value-not-confirmed");
  });

  it("KILL_SWITCH on => BLOCK (even with confirm + DRY_RUN off)", () => {
    const result = evaluateModifyGate(krLimitModify, "005930", {
      config: liveConfig({ killSwitch: true }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("kill-switch-on");
  });

  it("DRY_RUN off + confirm + within limit + kill off => SEND", () => {
    const result = evaluateModifyGate(krLimitModify, "005930", {
      config: liveConfig(),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("SEND");
    expect(result.notionalKrw).toBe(1_065_000);
  });

  it("price-only modify (no quantity) without originalQuantity => BLOCK", () => {
    // US price-only amendment: quantity omitted, no original quantity supplied.
    const priceOnly: OrderModifyRequest = {
      orderType: "LIMIT",
      price: "185.5",
      confirmHighValueOrder: false,
    };
    const result = evaluateModifyGate(priceOnly, "AAPL", {
      config: liveConfig(),
      confirm: true,
      accountSeq: 789,
      fxRate: 1380,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("notional-unknown");
  });

  it("price-only modify uses caller-supplied originalQuantity to value => SEND", () => {
    // US price-only: 10 shares (original) @ $185.5 = $1,855 * 1380 = 2,559,900 KRW.
    const priceOnly: OrderModifyRequest = {
      orderType: "LIMIT",
      price: "185.5",
      confirmHighValueOrder: false,
    };
    const result = evaluateModifyGate(priceOnly, "AAPL", {
      config: liveConfig(),
      confirm: true,
      accountSeq: 789,
      fxRate: 1380,
      originalQuantity: 10,
    });
    expect(result.notionalKrw).toBe(2_559_900);
    expect(result.decision).toBe("SEND");
  });
});

// --- evaluateCancelGate (pure) ----------------------------------------------

describe("evaluateCancelGate", () => {
  it("DRY_RUN default (true) => DRY_RUN", () => {
    const result = evaluateCancelGate({
      config: liveConfig({ dryRun: true }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("DRY_RUN");
  });

  it("KILL_SWITCH on => BLOCK (even with confirm + DRY_RUN off)", () => {
    const result = evaluateCancelGate({
      config: liveConfig({ killSwitch: true }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("kill-switch-on");
  });

  it("DRY_RUN off + confirm + kill off => SEND", () => {
    const result = evaluateCancelGate({
      config: liveConfig(),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("SEND");
  });

  it("DRY_RUN off but no confirm => DRY_RUN", () => {
    const result = evaluateCancelGate({
      config: liveConfig(),
      confirm: false,
      accountSeq: 789,
    });
    expect(result.decision).toBe("DRY_RUN");
  });

  it("does not value a notional (no limit/high-value check)", () => {
    // Even with MAX_ORDER_AMOUNT unset (which BLOCKS create/modify), a cancel
    // is allowed because it reduces risk and is not valued.
    const result = evaluateCancelGate({
      config: liveConfig({ maxOrderAmount: undefined }),
      confirm: true,
      accountSeq: 789,
    });
    expect(result.decision).toBe("SEND");
    expect(result.notionalKrw).toBeUndefined();
  });
});

// --- modifyOrder (executor) -------------------------------------------------

describe("modifyOrder", () => {
  it("DRY_RUN default => DRY_RUN, modifyOrderRaw NOT called", async () => {
    const h = opHarness();
    const result = await modifyOrder(
      { orderId: "ord-1", symbol: "005930", request: krLimitModify, confirm: true },
      {
        config: liveConfig({ dryRun: true }),
        modifyOrderRaw: h.modifyOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("DRY_RUN");
    if (result.status === "DRY_RUN") {
      expect(result.wouldSend).toEqual(krLimitModify);
    }
    expect(h.modifyOrderRaw).not.toHaveBeenCalled();
  });

  it("KR LIMIT new notional over limit => BLOCK, modifyOrderRaw NOT called", async () => {
    const h = opHarness();
    const result = await modifyOrder(
      { orderId: "ord-1", symbol: "005930", request: krLimitModify, confirm: true },
      {
        config: liveConfig({ maxOrderAmount: 1_000_000 }),
        modifyOrderRaw: h.modifyOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.modifyOrderRaw).not.toHaveBeenCalled();
  });

  it("US LIMIT over limit via fxRate => BLOCK; without fxRate => BLOCK", async () => {
    const usModify: OrderModifyRequest = {
      orderType: "LIMIT",
      quantity: "100",
      price: "200",
      confirmHighValueOrder: false,
    };
    const withFx = opHarness();
    const overLimit = await modifyOrder(
      { orderId: "ord-1", symbol: "AAPL", request: usModify, confirm: true, fxRate: 1380 },
      {
        config: liveConfig({ maxOrderAmount: 5_000_000 }),
        modifyOrderRaw: withFx.modifyOrderRawFn,
        now: withFx.now,
        auditLog: withFx.auditLogger,
        accountSeq: 789,
      },
    );
    expect(overLimit.status).toBe("BLOCKED");
    expect(withFx.modifyOrderRaw).not.toHaveBeenCalled();

    const noFx = opHarness();
    const unknown = await modifyOrder(
      { orderId: "ord-1", symbol: "AAPL", request: usModify, confirm: true },
      {
        config: liveConfig(),
        modifyOrderRaw: noFx.modifyOrderRawFn,
        now: noFx.now,
        auditLog: noFx.auditLogger,
        accountSeq: 789,
      },
    );
    expect(unknown.status).toBe("BLOCKED");
    if (unknown.status === "BLOCKED") {
      expect(unknown.reasons).toContain("notional-unknown");
    }
    expect(noFx.modifyOrderRaw).not.toHaveBeenCalled();
  });

  it("re-valued high-value without confirmHighValueOrder => BLOCK", async () => {
    const h = opHarness();
    const highValueModify: OrderModifyRequest = {
      orderType: "LIMIT",
      quantity: "2",
      price: "60000000",
      confirmHighValueOrder: false,
    };
    const result = await modifyOrder(
      { orderId: "ord-1", symbol: "005930", request: highValueModify, confirm: true },
      {
        config: liveConfig({ maxOrderAmount: 200_000_000 }),
        modifyOrderRaw: h.modifyOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.reasons).toContain("high-value-not-confirmed");
    }
    expect(h.modifyOrderRaw).not.toHaveBeenCalled();
  });

  it("DRY_RUN off + confirm + within limit + kill off => SEND, modifyOrderRaw called once", async () => {
    const h = opHarness();
    const result = await modifyOrder(
      { orderId: "ord-1", symbol: "005930", request: krLimitModify, confirm: true },
      {
        config: liveConfig(),
        modifyOrderRaw: h.modifyOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("SENT");
    expect(h.modifyOrderRaw).toHaveBeenCalledTimes(1);
    expect(h.modifyOrderRaw).toHaveBeenCalledWith({
      accountSeq: 789,
      orderId: "ord-1",
      body: krLimitModify,
    });
  });

  it("KILL_SWITCH on => BLOCK, modifyOrderRaw NOT called", async () => {
    const h = opHarness();
    const result = await modifyOrder(
      { orderId: "ord-1", symbol: "005930", request: krLimitModify, confirm: true },
      {
        config: liveConfig({ killSwitch: true }),
        modifyOrderRaw: h.modifyOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    expect(h.modifyOrderRaw).not.toHaveBeenCalled();
  });

  it("audit log records the modify decision (op=modify)", async () => {
    const h = opHarness();
    await modifyOrder(
      { orderId: "ord-1", symbol: "005930", request: krLimitModify, confirm: true },
      {
        config: liveConfig(),
        modifyOrderRaw: h.modifyOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(h.auditLog).toHaveBeenCalledTimes(1);
    expect(h.auditLog.mock.calls[0]?.[0]).toMatchObject({
      op: "modify",
      decision: "SEND",
      orderId: "ord-1",
    });
    const entry = JSON.stringify(h.auditLog.mock.calls[0]?.[0]);
    expect(entry).not.toMatch(/Bearer/);
    expect(entry).not.toMatch(/secret/i);
  });
});

// --- cancelOrder (executor) -------------------------------------------------

describe("cancelOrder", () => {
  it("DRY_RUN default => DRY_RUN, cancelOrderRaw NOT called", async () => {
    const h = opHarness();
    const result = await cancelOrder(
      { orderId: "ord-1", confirm: true },
      {
        config: liveConfig({ dryRun: true }),
        cancelOrderRaw: h.cancelOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("DRY_RUN");
    expect(h.cancelOrderRaw).not.toHaveBeenCalled();
  });

  it("KILL_SWITCH on => BLOCK, cancelOrderRaw NOT called", async () => {
    const h = opHarness();
    const result = await cancelOrder(
      { orderId: "ord-1", confirm: true },
      {
        config: liveConfig({ killSwitch: true }),
        cancelOrderRaw: h.cancelOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.reasons).toContain("kill-switch-on");
    }
    expect(h.cancelOrderRaw).not.toHaveBeenCalled();
  });

  it("DRY_RUN off + confirm => SEND, cancelOrderRaw called once", async () => {
    const h = opHarness();
    const result = await cancelOrder(
      { orderId: "ord-1", confirm: true },
      {
        config: liveConfig(),
        cancelOrderRaw: h.cancelOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("SENT");
    expect(h.cancelOrderRaw).toHaveBeenCalledTimes(1);
    expect(h.cancelOrderRaw).toHaveBeenCalledWith({
      accountSeq: 789,
      orderId: "ord-1",
    });
  });

  it("DRY_RUN off but no confirm => DRY_RUN, cancelOrderRaw NOT called", async () => {
    const h = opHarness();
    const result = await cancelOrder(
      { orderId: "ord-1", confirm: false },
      {
        config: liveConfig(),
        cancelOrderRaw: h.cancelOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(result.status).toBe("DRY_RUN");
    expect(h.cancelOrderRaw).not.toHaveBeenCalled();
  });

  it("audit log records the cancel decision (op=cancel)", async () => {
    const h = opHarness();
    await cancelOrder(
      { orderId: "ord-1", confirm: true },
      {
        config: liveConfig(),
        cancelOrderRaw: h.cancelOrderRawFn,
        now: h.now,
        auditLog: h.auditLogger,
        accountSeq: 789,
      },
    );
    expect(h.auditLog).toHaveBeenCalledTimes(1);
    expect(h.auditLog.mock.calls[0]?.[0]).toMatchObject({
      op: "cancel",
      decision: "SEND",
      orderId: "ord-1",
    });
  });
});

// --- orderModifyRequestSchema -----------------------------------------------

describe("orderModifyRequestSchema", () => {
  it("accepts a KR LIMIT modify with price + quantity", () => {
    const parsed = orderModifyRequestSchema.parse({
      orderType: "LIMIT",
      quantity: "15",
      price: "71000",
    });
    expect(parsed).toMatchObject({ orderType: "LIMIT", price: "71000" });
  });

  it("accepts a US LIMIT price-only modify (no quantity)", () => {
    const parsed = orderModifyRequestSchema.parse({
      orderType: "LIMIT",
      price: "185.5",
    });
    expect(parsed).toMatchObject({ orderType: "LIMIT", price: "185.5" });
  });

  it("rejects a LIMIT modify missing price", () => {
    const result = orderModifyRequestSchema.safeParse({
      orderType: "LIMIT",
      quantity: "15",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a MARKET modify carrying price", () => {
    const result = orderModifyRequestSchema.safeParse({
      orderType: "MARKET",
      price: "71000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional (non-integer) quantity", () => {
    const result = orderModifyRequestSchema.safeParse({
      orderType: "LIMIT",
      quantity: "15.5",
      price: "71000",
    });
    expect(result.success).toBe(false);
  });
});
