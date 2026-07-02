import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Replace the endpoints module so the auto-trader's live market-data lookups
 * (getPrices / getExchangeRate) and the gate's raw POST (createOrderRaw) are all
 * `vi.fn` spies. This lets a test drive a lookup failure / non-finite value and
 * assert the fail-safe mapping BLOCKs the order without ever reaching the raw
 * POST — the resolver->gate wiring that `auto-executor.test.ts` doesn't exercise
 * (it injects `priceFor` / `fxRate` directly).
 */
vi.mock("@/lib/server/toss/endpoints", () => ({
  getPrices: vi.fn(),
  getExchangeRate: vi.fn(),
  createOrderRaw: vi.fn(),
}));

/**
 * Force a "live" config (DRY_RUN off, kill off, generous limit) with
 * AUTO_TRADE_ENABLED on — the ONLY state in which a real order is reachable. A
 * BLOCK under these conditions therefore proves the fail-safe input mapping, not
 * just a disarmed default.
 */
vi.mock("@/lib/server/env", () => ({
  getEnv: vi.fn(() => ({
    DRY_RUN: false,
    KILL_SWITCH: false,
    AUTO_TRADE_ENABLED: true,
    MAX_ORDER_AMOUNT: 100_000_000,
    DAILY_LOSS_LIMIT: undefined,
  })),
}));

import type { TossClient } from "@/lib/server/toss/client";
import {
  createOrderRaw,
  getExchangeRate,
  getPrices,
} from "@/lib/server/toss/endpoints";
import { createServerAutoTrader } from "@/lib/server/trading/auto-trader";
import type { OrderIntent } from "@/lib/server/trading/strategy/types";

const getPricesMock = vi.mocked(getPrices);
const getExchangeRateMock = vi.mocked(getExchangeRate);
const createOrderRawMock = vi.mocked(createOrderRaw);

// The lookups/raw-POST ignore the client arg (they are mocked), so a bare stub
// is enough to construct the trader.
const client = {} as unknown as TossClient;

/** KRW MARKET quantity-based: valued from a resolved native reference price. */
const krwMarket: OrderIntent = {
  symbol: "005930",
  currency: "KRW",
  side: "SELL",
  orderType: "MARKET",
  quantity: "10",
  reason: "stop-loss",
};

/** USD LIMIT: valued from its own price but needs the USD->KRW rate to convert. */
const usdLimit: OrderIntent = {
  symbol: "AAPL",
  currency: "USD",
  side: "BUY",
  orderType: "LIMIT",
  quantity: "5",
  price: "200",
  reason: "entry",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Silence the audit logger's console output; it carries no assertion here.
  vi.spyOn(console, "info").mockImplementation(() => {});
  createOrderRawMock.mockResolvedValue({ orderId: "srv-1", clientOrderId: null });
});

describe("createServerAutoTrader.runOnce — reference-price fail-safe mapping", () => {
  it("MARKET intent, getPrices throws => BLOCKED (notional-unknown), raw POST never called", async () => {
    getPricesMock.mockRejectedValue(new Error("price lookup failed"));
    const out = await createServerAutoTrader(client).runOnce(789, [krwMarket]);
    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 1 });
    expect(out.results[0]?.status).toBe("BLOCKED");
    expect(out.results[0]?.reasons).toContain("notional-unknown");
    expect(createOrderRawMock).not.toHaveBeenCalled();
  });

  it("MARKET intent, non-finite lastPrice => BLOCKED (notional-unknown), raw POST never called", async () => {
    getPricesMock.mockResolvedValue([
      { symbol: "005930", lastPrice: "unknown", currency: "KRW" },
    ]);
    const out = await createServerAutoTrader(client).runOnce(789, [krwMarket]);
    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 1 });
    expect(out.results[0]?.reasons).toContain("notional-unknown");
    expect(createOrderRawMock).not.toHaveBeenCalled();
  });

  it("MARKET intent within limits with a finite price => SENT, raw POST called once", async () => {
    getPricesMock.mockResolvedValue([
      { symbol: "005930", lastPrice: "70000", currency: "KRW" },
    ]);
    const out = await createServerAutoTrader(client).runOnce(789, [krwMarket]);
    expect(out.summary).toEqual({ sent: 1, dryRun: 0, blocked: 0 });
    expect(out.results[0]?.status).toBe("SENT");
    expect(createOrderRawMock).toHaveBeenCalledTimes(1);
  });
});

describe("createServerAutoTrader.runOnce — fxRate fail-safe mapping", () => {
  it("USD intent, getExchangeRate throws => BLOCKED (notional-unknown), raw POST never called", async () => {
    getExchangeRateMock.mockRejectedValue(new Error("rate lookup failed"));
    const out = await createServerAutoTrader(client).runOnce(789, [usdLimit]);
    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 1 });
    expect(out.results[0]?.reasons).toContain("notional-unknown");
    expect(createOrderRawMock).not.toHaveBeenCalled();
  });

  it("USD intent, non-finite rate => BLOCKED (notional-unknown), raw POST never called", async () => {
    getExchangeRateMock.mockResolvedValue({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      rate: "abc",
      midRate: "abc",
      basisPoint: "0",
      rateChangeType: "EQUAL",
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2026-01-01T00:10:00Z",
    });
    const out = await createServerAutoTrader(client).runOnce(789, [usdLimit]);
    expect(out.summary).toEqual({ sent: 0, dryRun: 0, blocked: 1 });
    expect(out.results[0]?.reasons).toContain("notional-unknown");
    expect(createOrderRawMock).not.toHaveBeenCalled();
  });
});
