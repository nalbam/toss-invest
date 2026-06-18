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

export type OrderSide = "BUY" | "SELL" | (string & {});
export type OrderType = "LIMIT" | "MARKET" | (string & {});
export type TimeInForce = "DAY" | "CLS" | "OPG" | (string & {});
export type OrderStatus =
  | "PENDING"
  | "PENDING_CANCEL"
  | "PENDING_REPLACE"
  | "PARTIAL_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "CANCEL_REJECTED"
  | "REPLACE_REJECTED"
  | "REPLACED"
  | (string & {});

export interface OrderExecution {
  filledQuantity: string;
  averageFilledPrice: string | null;
  filledAmount: string | null;
  commission: string | null;
  tax: string | null;
  filledAt: string | null;
  settlementDate: string | null;
}

export interface Order {
  orderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  price: string | null;
  quantity: string;
  orderAmount: string | null;
  currency: Currency;
  orderedAt: string;
  canceledAt: string | null;
  execution: OrderExecution;
}

export interface PaginatedOrderResponse {
  orders: Order[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface PriceResponse {
  symbol: string;
  timestamp?: string | null;
  lastPrice: string;
  currency: Currency;
}

export interface PriceLimitResponse {
  timestamp: string;
  upperLimitPrice: string | null;
  lowerLimitPrice: string | null;
  currency: Currency;
}

export interface OrderbookEntry {
  price: string;
  volume: string;
}

export interface OrderbookResponse {
  timestamp: string | null;
  currency: Currency;
  asks: OrderbookEntry[];
  bids: OrderbookEntry[];
}

export interface Candle {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: Currency;
}

export interface CandlePageResponse {
  candles: Candle[];
  nextBefore: string | null;
}
