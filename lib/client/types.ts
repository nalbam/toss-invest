/**
 * Client-only mirrors of the API response shapes.
 *
 * The browser must never import from `lib/server/**` (the bundle-secret guard
 * enforces this), so these types are declared independently here. They mirror
 * the zod schemas in `lib/server/toss/schemas.ts`; keep them in sync when the
 * server contract changes.
 *
 * Every `decimal` money/quantity field is a string to preserve precision — the
 * UI formats the string for display but never parses it back into storage.
 */

export type Currency = "KRW" | "USD" | (string & {});
export type MarketCountry = "KR" | "US" | (string & {});
export type RateChangeType = "UP" | "EQUAL" | "DOWN" | (string & {});

/** A money amount expressed in both currencies; `usd` is null when unavailable. */
export interface Price {
  krw: string;
  usd: string | null;
}

export interface Account {
  accountNo: string;
  accountSeq: number;
  accountType: string;
}

export interface OverviewMarketValue {
  amount: Price;
  amountAfterCost: Price;
}

export interface OverviewProfitLoss {
  amount: Price;
  amountAfterCost: Price;
  rate: string;
  rateAfterCost: string;
}

export interface OverviewDailyProfitLoss {
  amount: Price;
  rate: string;
}

export interface ItemMarketValue {
  purchaseAmount: string;
  amount: string;
  amountAfterCost: string;
}

export interface ItemProfitLoss {
  amount: string;
  amountAfterCost: string;
  rate: string;
  rateAfterCost: string;
}

export interface ItemDailyProfitLoss {
  amount: string;
  rate: string;
}

export interface ItemCost {
  commission: string;
  tax: string | null;
}

export interface HoldingsItem {
  symbol: string;
  name: string;
  marketCountry: MarketCountry;
  currency: Currency;
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue: ItemMarketValue;
  profitLoss: ItemProfitLoss;
  dailyProfitLoss: ItemDailyProfitLoss;
  cost: ItemCost;
}

export interface HoldingsOverview {
  totalPurchaseAmount: Price;
  marketValue: OverviewMarketValue;
  profitLoss: OverviewProfitLoss;
  dailyProfitLoss: OverviewDailyProfitLoss;
  items: HoldingsItem[];
}

export interface ExchangeRateResponse {
  baseCurrency: Currency;
  quoteCurrency: Currency;
  rate: string;
  midRate: string;
  basisPoint: string;
  rateChangeType: RateChangeType;
  validFrom: string;
  validUntil: string;
}
