import { describe, expect, it } from "vitest";
import { API_GROUP_TPS, POLLING_INTERVAL_MS } from "@/lib/client/polling";

function rps(intervalMs: number): number {
  return 1000 / intervalMs;
}

describe("dashboard polling intervals", () => {
  it("keeps steady dashboard polling below documented API group limits", () => {
    expect(rps(POLLING_INTERVAL_MS.account)).toBeLessThanOrEqual(
      API_GROUP_TPS.ACCOUNT,
    );
    expect(rps(POLLING_INTERVAL_MS.holdings)).toBeLessThanOrEqual(
      API_GROUP_TPS.ASSET,
    );
    expect(rps(POLLING_INTERVAL_MS.orders)).toBeLessThanOrEqual(
      API_GROUP_TPS.ORDER_HISTORY,
    );

    const selectedSymbolMarketDataRps =
      rps(POLLING_INTERVAL_MS.prices) +
      rps(POLLING_INTERVAL_MS.orderbook) +
      rps(POLLING_INTERVAL_MS.priceLimits);
    expect(selectedSymbolMarketDataRps).toBeLessThanOrEqual(
      API_GROUP_TPS.MARKET_DATA,
    );

    const chartRps = rps(POLLING_INTERVAL_MS.candles) * 2;
    expect(chartRps).toBeLessThanOrEqual(API_GROUP_TPS.MARKET_DATA_CHART);

    expect(rps(POLLING_INTERVAL_MS.exchangeRate)).toBeLessThanOrEqual(
      API_GROUP_TPS.MARKET_INFO,
    );

    const cashBalanceRps = rps(POLLING_INTERVAL_MS.cashBalance) * 2;
    expect(cashBalanceRps).toBeLessThanOrEqual(API_GROUP_TPS.ORDER_INFO);
  });
});
