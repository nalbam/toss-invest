import { describe, expect, it, vi } from "vitest";
import {
  intentToOrderRequest,
  runAutoTrade,
  type RunAutoTradeDeps,
} from "@/lib/server/trading/auto-executor";
import type { AuditLogger, TradingConfig } from "@/lib/server/trading/safety";
import type { OrderIntent } from "@/lib/server/trading/strategy/types";

// --- fixtures ---------------------------------------------------------------

/** A KRW MARKET sell of 10 shares of 005930 (Samsung). */
const marketSell: OrderIntent = {
  symbol: "005930",
  currency: "KRW",
  side: "SELL",
  orderType: "MARKET",
  quantity: "10",
  reason: "stop-loss",
};

/** A KRW LIMIT sell carrying its own price (no reference price needed). */
const limitSell: OrderIntent = {
  symbol: "005930",
  currency: "KRW",
  side: "SELL",
  orderType: "LIMIT",
  quantity: "10",
  price: "70000",
  reason: "take-profit",
};

/**
 * Base config: real orders are *possible* (DRY_RUN off, generous limit, kill
 * off). Individual tests override DRY_RUN / killSwitch / maxOrderAmount.
 */
function liveConfig(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    dryRun: false,
    killSwitch: false,
    maxOrderAmount: 100_000_000,
    dailyLossLimit: undefined,
    ...overrides,
  };
}

/**
 * Builds injectable deps where `createOrderRaw` and `auditLog` are `vi.fn`
 * spies (so tests can assert whether the raw POST was reached). The spies are
 * the actual dep fns, so no extra wiring is needed. Defaults: armed off, real
 * orders possible, a KRW reference price of 70,000.
 */
function deps(overrides: Partial<RunAutoTradeDeps> = {}): RunAutoTradeDeps & {
  createOrderRaw: ReturnType<typeof vi.fn>;
  auditLog: ReturnType<typeof vi.fn>;
} {
  const createOrderRaw = vi.fn(async () => ({
    orderId: "srv-order-1",
    clientOrderId: null,
  }));
  const auditLog = vi.fn(() => {}) as ReturnType<typeof vi.fn> & AuditLogger;
  return {
    config: liveConfig(),
    autoTradeEnabled: false,
    createOrderRaw: createOrderRaw as unknown as RunAutoTradeDeps["createOrderRaw"],
    now: () => 1_700_000_000_000,
    auditLog,
    accountSeq: 789,
    // KRW reference price for MARKET valuation (10 * 70000 = 700,000 KRW).
    priceFor: () => 70_000,
    ...overrides,
  } as RunAutoTradeDeps & {
    createOrderRaw: ReturnType<typeof vi.fn>;
    auditLog: ReturnType<typeof vi.fn>;
  };
}

// --- intentToOrderRequest (pure) --------------------------------------------

describe("intentToOrderRequest", () => {
  it("converts a SELL MARKET intent (quantity-based, no price)", () => {
    const request = intentToOrderRequest(marketSell);
    expect(request).toEqual({
      symbol: "005930",
      side: "SELL",
      orderType: "MARKET",
      timeInForce: "DAY",
      quantity: "10",
      confirmHighValueOrder: false,
    });
    // MARKET must NOT carry a price.
    expect("price" in request).toBe(false);
  });

  it("carries price for a LIMIT intent", () => {
    const request = intentToOrderRequest(limitSell);
    expect(request).toMatchObject({
      symbol: "005930",
      side: "SELL",
      orderType: "LIMIT",
      quantity: "10",
      price: "70000",
    });
  });

  it("never auto-confirms a high-value order (confirmHighValueOrder=false)", () => {
    const request = intentToOrderRequest(marketSell);
    expect(request.confirmHighValueOrder).toBe(false);
  });
});

// --- runAutoTrade (gated through the real §6 placeOrder) --------------------

describe("runAutoTrade — AUTO_TRADE_ENABLED default false", () => {
  it("AUTO_TRADE_ENABLED=false (default) => every intent DRY_RUN, createOrderRaw NEVER called", async () => {
    // Even with DRY_RUN off and within limits: the missing human confirm
    // (autoTradeEnabled=false) downgrades every order to DRY_RUN.
    const d = deps({ autoTradeEnabled: false, config: liveConfig() });
    const out = await runAutoTrade([marketSell, limitSell], d);

    expect(out.summary).toEqual({ sent: 0, dryRun: 2, blocked: 0 });
    expect(out.results.every((r) => r.status === "DRY_RUN")).toBe(true);
    expect(d.createOrderRaw).not.toHaveBeenCalled();
  });
});

describe("runAutoTrade — dry-run / send paths", () => {
  it("AUTO_TRADE_ENABLED=true + DRY_RUN=true => DRY_RUN, createOrderRaw NOT called", async () => {
    const d = deps({
      autoTradeEnabled: true,
      config: liveConfig({ dryRun: true }),
    });
    const out = await runAutoTrade([marketSell, limitSell], d);

    expect(out.summary).toEqual({ sent: 0, dryRun: 2, blocked: 0 });
    expect(d.createOrderRaw).not.toHaveBeenCalled();
  });

  it("AUTO_TRADE_ENABLED=true + DRY_RUN=false + within limit + kill off + price known => SEND, createOrderRaw called per intent", async () => {
    const d = deps({ autoTradeEnabled: true, config: liveConfig() });
    const out = await runAutoTrade([marketSell, limitSell], d);

    expect(out.summary).toEqual({ sent: 2, dryRun: 0, blocked: 0 });
    expect(out.results.every((r) => r.status === "SENT")).toBe(true);
    expect(d.createOrderRaw).toHaveBeenCalledTimes(2);
    // The MARKET intent's body is sent quantity-based with no price.
    expect(d.createOrderRaw).toHaveBeenCalledWith({
      accountSeq: 789,
      body: {
        symbol: "005930",
        side: "SELL",
        orderType: "MARKET",
        timeInForce: "DAY",
        quantity: "10",
        confirmHighValueOrder: false,
      },
    });
  });
});

describe("runAutoTrade — §6 hard barriers (createOrderRaw never called)", () => {
  it("KILL_SWITCH on => every intent BLOCKED, createOrderRaw NOT called (even armed + DRY_RUN off)", async () => {
    const d = deps({
      autoTradeEnabled: true,
      config: liveConfig({ killSwitch: true }),
    });
    const out = await runAutoTrade([marketSell, limitSell], d);

    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 2 });
    expect(out.results.every((r) => r.status === "BLOCKED")).toBe(true);
    expect(out.results[0]?.reasons).toContain("kill-switch-on");
    expect(d.createOrderRaw).not.toHaveBeenCalled();
  });

  it("notional over MAX_ORDER_AMOUNT => BLOCKED, createOrderRaw NOT called", async () => {
    // 10 * 70,000 = 700,000 > 500,000 limit.
    const d = deps({
      autoTradeEnabled: true,
      config: liveConfig({ maxOrderAmount: 500_000 }),
    });
    const out = await runAutoTrade([marketSell, limitSell], d);

    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 2 });
    expect(out.results[0]?.reasons).toContain("max-order-amount-exceeded");
    expect(d.createOrderRaw).not.toHaveBeenCalled();
  });

  it("MAX_ORDER_AMOUNT unset => BLOCKED, createOrderRaw NOT called", async () => {
    const d = deps({
      autoTradeEnabled: true,
      config: liveConfig({ maxOrderAmount: undefined }),
    });
    const out = await runAutoTrade([marketSell], d);

    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 1 });
    expect(out.results[0]?.reasons).toContain("max-order-amount-unset");
    expect(d.createOrderRaw).not.toHaveBeenCalled();
  });

  it("MARKET with unknown reference price (priceFor undefined) => BLOCKED notional-unknown, createOrderRaw NOT called", async () => {
    const d = deps({
      autoTradeEnabled: true,
      config: liveConfig(),
      priceFor: () => undefined,
    });
    const out = await runAutoTrade([marketSell], d);

    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 1 });
    expect(out.results[0]?.status).toBe("BLOCKED");
    expect(out.results[0]?.reasons).toContain("notional-unknown");
    expect(d.createOrderRaw).not.toHaveBeenCalled();
  });
});

describe("runAutoTrade — summary aggregation + audit", () => {
  it("aggregates a mixed pass (SENT + BLOCKED) and audits every attempt", async () => {
    // LIMIT (700,000) sends; MARKET BLOCKs because its price is unknown.
    const d = deps({
      autoTradeEnabled: true,
      config: liveConfig(),
      priceFor: () => undefined,
    });
    const out = await runAutoTrade([limitSell, marketSell], d);

    expect(out.summary).toEqual({ sent: 1, dryRun: 0, blocked: 1 });
    expect(out.results[0]).toMatchObject({ intent: limitSell, status: "SENT" });
    expect(out.results[1]).toMatchObject({
      intent: marketSell,
      status: "BLOCKED",
    });
    // placeOrder records one audit entry per attempt (no duplicate from here).
    expect(d.auditLog).toHaveBeenCalledTimes(2);
    expect(d.createOrderRaw).toHaveBeenCalledTimes(1);
  });

  it("an empty intent list does nothing and zero-tallies", async () => {
    const d = deps({ autoTradeEnabled: true, config: liveConfig() });
    const out = await runAutoTrade([], d);

    expect(out.results).toEqual([]);
    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 0 });
    expect(d.createOrderRaw).not.toHaveBeenCalled();
    expect(d.auditLog).not.toHaveBeenCalled();
  });
});
