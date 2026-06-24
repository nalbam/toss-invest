import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  Account,
  CandlePageResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  OrderbookResponse,
  PaginatedOrderResponse,
  PriceLimitResponse,
  PriceResponse,
} from "@/lib/client/types";

/**
 * Full-browser render check for the dashboard. Every `/api/*` request is
 * intercepted in the browser via `page.route` and fulfilled with a `{ data }`
 * envelope, so the dev server's proxy routes (and the real Toss API) are never
 * reached — no live credentials are needed. The mocks mirror the contract
 * shapes in `lib/client/types.ts` and reuse the fixture style from the jsdom
 * component tests (e.g. HoldingsTable.test.tsx).
 */

const accounts: Account[] = [
  { accountNo: "123", accountSeq: 1, accountType: "BROKERAGE" },
];

const holdings: HoldingsOverview = {
  totalPurchaseAmount: { krw: "2100000", usd: "1500.00" },
  marketValue: {
    amount: { krw: "2020000", usd: "1450.00" },
    amountAfterCost: { krw: "2017000", usd: "1448.00" },
  },
  profitLoss: {
    amount: { krw: "-80000", usd: "-50.00" },
    amountAfterCost: { krw: "-83000", usd: "-52.00" },
    rate: "-0.0381",
    rateAfterCost: "-0.0395",
  },
  dailyProfitLoss: {
    amount: { krw: "3000", usd: "2.00" },
    rate: "0.0015",
  },
  items: [
    {
      symbol: "005930",
      name: "삼성전자",
      marketCountry: "KR",
      currency: "KRW",
      quantity: "10",
      lastPrice: "72000",
      averagePurchasePrice: "65000",
      marketValue: {
        purchaseAmount: "650000",
        amount: "720000",
        amountAfterCost: "719000",
      },
      profitLoss: {
        amount: "70000",
        amountAfterCost: "69000",
        rate: "0.1077",
        rateAfterCost: "0.1062",
      },
      dailyProfitLoss: { amount: "5000", rate: "0.007" },
      cost: { commission: "100", tax: null },
    },
    {
      symbol: "AAPL",
      name: "Apple",
      marketCountry: "US",
      currency: "USD",
      quantity: "5",
      lastPrice: "190.50",
      averagePurchasePrice: "210.00",
      marketValue: {
        purchaseAmount: "1450000",
        amount: "1300000",
        amountAfterCost: "1298000",
      },
      profitLoss: {
        amount: "-150000",
        amountAfterCost: "-152000",
        rate: "-0.1034",
        rateAfterCost: "-0.1048",
      },
      dailyProfitLoss: { amount: "-2000", rate: "-0.0015" },
      cost: { commission: "1.5", tax: null },
    },
  ],
};

const exchangeRate: ExchangeRateResponse = {
  baseCurrency: "USD",
  quoteCurrency: "KRW",
  rate: "1392.50",
  midRate: "1392.00",
  basisPoint: "5",
  rateChangeType: "UP",
  validFrom: "2026-06-18T00:00:00",
  validUntil: "2026-06-18T23:59:59",
};

const prices: PriceResponse[] = [
  { symbol: "005930", lastPrice: "72000", currency: "KRW", timestamp: null },
];

const priceLimits: PriceLimitResponse = {
  timestamp: "2026-06-18T09:00:00",
  upperLimitPrice: "93600",
  lowerLimitPrice: "50400",
  currency: "KRW",
};

const orderbook: OrderbookResponse = {
  timestamp: "2026-06-18T09:00:00",
  currency: "KRW",
  asks: [
    { price: "72100", volume: "100" },
    { price: "72200", volume: "200" },
  ],
  bids: [
    { price: "72000", volume: "150" },
    { price: "71900", volume: "250" },
  ],
};

const candles: CandlePageResponse = {
  candles: [
    {
      timestamp: "2026-06-17T00:00:00",
      openPrice: "71000",
      highPrice: "72500",
      lowPrice: "70800",
      closePrice: "72000",
      volume: "1000000",
      currency: "KRW",
    },
    {
      timestamp: "2026-06-18T00:00:00",
      openPrice: "72000",
      highPrice: "73000",
      lowPrice: "71500",
      closePrice: "72800",
      volume: "1200000",
      currency: "KRW",
    },
  ],
  nextBefore: null,
};

const orders: PaginatedOrderResponse = {
  orders: [
    {
      orderId: "ord-1",
      symbol: "005930",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      status: "PENDING",
      price: "71000",
      quantity: "5",
      orderAmount: "355000",
      currency: "KRW",
      orderedAt: "2026-06-18T09:30:00",
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
    },
  ],
  nextCursor: null,
  hasNext: false,
};

const advisorResult = {
  advice: "삼성전자 비중이 높습니다. 분산을 고려하세요.",
  proposals: [
    {
      proposal: { kind: "trim", symbol: "005930", side: "SELL", quantity: 3, rationale: "비중 축소" },
      valid: true,
      reasons: [],
    },
  ],
  model: "test-model",
  generatedAt: "2026-06-18T00:00:00Z",
};

/** Fulfills a route with the success `{ data }` envelope used by every route. */
function fulfillData(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

/**
 * Routes every `/api/*` request by pathname (most specific first). Anything
 * unmatched is fulfilled with `{ data: null }` so SWR never hits the network.
 */
async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/accounts") return fulfillData(route, accounts);
    if (path === "/api/holdings") return fulfillData(route, holdings);
    if (path === "/api/exchange-rate") return fulfillData(route, exchangeRate);
    if (path === "/api/prices") return fulfillData(route, prices);
    if (path === "/api/price-limits") return fulfillData(route, priceLimits);
    if (path === "/api/orderbook") return fulfillData(route, orderbook);
    if (path === "/api/candles") return fulfillData(route, candles);
    if (path === "/api/orders") return fulfillData(route, orders);
    if (path === "/api/advisor") return fulfillData(route, advisorResult);
    return fulfillData(route, null);
  });
}

test("renders portfolio summary, holdings, orders, and market quote", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");

  // Portfolio summary: total market value (KRW) + total P/L.
  const summary = page.getByRole("region", { name: "포트폴리오 요약" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("총 평가금액")).toBeVisible();
  await expect(summary.getByText("₩2,020,000")).toBeVisible();
  await expect(summary.getByText("총 손익")).toBeVisible();

  // Holdings table: one row per holding with its name.
  const holdingsSection = page.getByRole("region", { name: "보유 종목" });
  await expect(holdingsSection).toBeVisible();
  await expect(holdingsSection.getByText("삼성전자")).toBeVisible();
  await expect(holdingsSection.getByText("Apple")).toBeVisible();

  // Orders section: the single open order's symbol and side (▲ buy glyph,
  // labelled "매수" for assistive tech).
  const ordersSection = page.getByRole("region", {
    name: "주문 내역",
  });
  await expect(ordersSection).toBeVisible();
  await expect(ordersSection.getByText("005930")).toBeVisible();
  await expect(ordersSection.getByLabel("매수")).toBeVisible();

  // Market quote: last price for the default (first holding's) symbol. The
  // "현재가" label and its price live in the same `.metric` block; scope to that
  // block (the label span's parent) so the orderbook's matching ₩72,000 bid
  // below doesn't collide.
  const quote = page.getByRole("region", { name: "시세" });
  await expect(quote).toBeVisible();
  const currentPrice = quote.getByText("현재가 (005930)").locator("..");
  await expect(currentPrice.getByText("현재가 (005930)")).toBeVisible();
  await expect(currentPrice.getByText("₩72,000")).toBeVisible();
});

test("renders the AI advisor card and shows proposals on demand", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");

  const advisor = page.getByRole("region", { name: "AI 어드바이저" });
  await expect(advisor).toBeVisible();
  // The disclaimer is always present; advice/proposals only after the button.
  await expect(advisor.getByText(/참고용/)).toBeVisible();
  await expect(advisor.getByText(/분산을 고려/)).toHaveCount(0);

  await advisor.getByRole("button", { name: "조언 받기" }).click();

  await expect(advisor.getByText(/분산을 고려하세요/)).toBeVisible();
  await expect(advisor.getByText("005930 · SELL 3")).toBeVisible();
  await expect(advisor.getByRole("button", { name: "폼에 담기" })).toBeVisible();
});
