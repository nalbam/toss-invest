import { describe, expect, it } from "vitest";
import { buildAdvisorSnapshot, type RawAdvisorInputs } from "./snapshot";
import type {
  BuyingPowerResponse,
  ExchangeRateResponse,
  HoldingsOverview,
} from "@/lib/server/toss/schemas";

function holdingsOverview(): HoldingsOverview {
  return {
    totalPurchaseAmount: { krw: "9000", usd: null },
    marketValue: {
      amount: { krw: "10000", usd: null },
      amountAfterCost: { krw: "9950", usd: null },
    },
    profitLoss: {
      amount: { krw: "1000", usd: null },
      amountAfterCost: { krw: "950", usd: null },
      rate: "0.11",
      rateAfterCost: "0.1",
    },
    dailyProfitLoss: { amount: { krw: "50", usd: null }, rate: "0.005" },
    items: [
      {
        symbol: "005930",
        name: "삼성전자",
        marketCountry: "KR",
        currency: "KRW",
        quantity: "10",
        lastPrice: "700",
        averagePurchasePrice: "650",
        marketValue: { purchaseAmount: "6500", amount: "7000", amountAfterCost: "6970" },
        profitLoss: { amount: "500", amountAfterCost: "470", rate: "0.077", rateAfterCost: "0.07" },
        dailyProfitLoss: { amount: "30", rate: "0.004" },
        cost: { commission: "5", tax: null },
      },
      {
        symbol: "AAPL",
        name: "Apple",
        marketCountry: "US",
        currency: "USD",
        quantity: "2",
        lastPrice: "150",
        averagePurchasePrice: "140",
        marketValue: { purchaseAmount: "280", amount: "3000", amountAfterCost: "2980" },
        profitLoss: { amount: "500", amountAfterCost: "480", rate: "0.18", rateAfterCost: "0.17" },
        dailyProfitLoss: { amount: "20", rate: "0.006" },
        cost: { commission: "2", tax: null },
      },
    ],
  };
}

const buyingPower: BuyingPowerResponse = { currency: "KRW", cashBuyingPower: "1234567" };

const exchangeRate: ExchangeRateResponse = {
  baseCurrency: "USD",
  quoteCurrency: "KRW",
  rate: "1350.5",
  midRate: "1350.0",
  basisPoint: "5",
  rateChangeType: "UP",
  validFrom: "2026-06-19T00:00:00Z",
  validUntil: "2026-06-20T00:00:00Z",
};

const HOLDING_KEYS = [
  "symbol",
  "name",
  "market",
  "currency",
  "quantity",
  "lastPrice",
  "averagePurchasePrice",
  "marketValue",
  "profitLoss",
  "profitLossRate",
  "weightPercent",
].sort();

describe("buildAdvisorSnapshot", () => {
  it("maps holdings to exactly the whitelisted fields (no raw leakage)", () => {
    const inputs: RawAdvisorInputs = { holdings: holdingsOverview(), buyingPower };
    const snapshot = buildAdvisorSnapshot(inputs);

    expect(snapshot.holdings).toHaveLength(2);
    for (const holding of snapshot.holdings) {
      expect(Object.keys(holding).sort()).toEqual(HOLDING_KEYS);
    }
    const samsung = snapshot.holdings[0];
    expect(samsung).toMatchObject({
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      quantity: "10",
      lastPrice: "700",
      averagePurchasePrice: "650",
      marketValue: "7000",
      profitLoss: "500",
      profitLossRate: "0.077",
    });
  });

  it("computes weight percent from market values", () => {
    const snapshot = buildAdvisorSnapshot({ holdings: holdingsOverview(), buyingPower });
    expect(snapshot.holdings[0].weightPercent).toBe(70);
    expect(snapshot.holdings[1].weightPercent).toBe(30);
  });

  it("treats a zero total market value as zero weight (no division by zero)", () => {
    const empty = holdingsOverview();
    empty.items = empty.items.map((item) => ({
      ...item,
      marketValue: { ...item.marketValue, amount: "0" },
    }));
    const snapshot = buildAdvisorSnapshot({ holdings: empty, buyingPower });
    expect(snapshot.holdings.every((h) => h.weightPercent === 0)).toBe(true);
  });

  it("includes cash buying power and the exchange rate when present", () => {
    const snapshot = buildAdvisorSnapshot({
      holdings: holdingsOverview(),
      buyingPower,
      exchangeRate,
    });
    expect(snapshot.cash).toEqual({ currency: "KRW", buyingPower: "1234567" });
    expect(snapshot.exchangeRate).toEqual({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      rate: "1350.5",
    });
  });

  it("sets exchangeRate to null when not provided", () => {
    const snapshot = buildAdvisorSnapshot({ holdings: holdingsOverview(), buyingPower });
    expect(snapshot.exchangeRate).toBeNull();
  });

  it("never includes account identifiers or PII in the serialized snapshot", () => {
    const snapshot = buildAdvisorSnapshot({
      holdings: holdingsOverview(),
      buyingPower,
      exchangeRate,
    });
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["accountNo", "accountSeq", "accountType"]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Raw-only fields must not leak either.
    for (const rawOnly of ["amountAfterCost", "dailyProfitLoss", "commission"]) {
      expect(serialized).not.toContain(rawOnly);
    }
  });
});
