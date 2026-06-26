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

export interface BuyingPower {
  currency: "KRW" | "USD";
  cashBuyingPower: string;
}

export interface SellableQuantity {
  sellableQuantity: string;
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

/**
 * Client mirror of the order-create request body (`POST /api/orders`). Either a
 * quantity-based order (`quantity`, with `price` required for LIMIT) or an
 * amount-based US MARKET order (`orderAmount`). `confirm` is the per-order human
 * confirmation read only from the body; the server defaults it to `false`, so
 * omitting it yields a DRY_RUN preview.
 */
export interface OrderCreateBody {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  timeInForce?: "DAY" | "CLS";
  quantity?: string;
  price?: string;
  orderAmount?: string;
  confirmHighValueOrder?: boolean;
  confirm?: boolean;
}

/** Informational prevalidation attached to the order result (advisory only). */
export interface OrderPrevalidation {
  side: OrderSide;
  available: string | null;
  requested: string | null;
  insufficient: boolean;
}

/**
 * Client mirror of the `POST /api/orders` success payload. The §6 safety gate
 * decides the `status`; `prevalidation` is attached to every outcome.
 *   - DRY_RUN: preview only — `wouldSend` echoes the would-be request.
 *   - SENT: a real order was placed — `response.orderId` is the server id.
 *   - BLOCKED: a guard refused the order — `reasons` lists why.
 */
export type OrderPlaceResult =
  | {
      status: "DRY_RUN";
      wouldSend: OrderCreateBody;
      reasons: string[];
      prevalidation: OrderPrevalidation;
    }
  | {
      status: "SENT";
      response: { orderId: string; clientOrderId?: string | null };
      notionalKrw: number;
      prevalidation: OrderPrevalidation;
    }
  | {
      status: "BLOCKED";
      request: OrderCreateBody;
      reasons: string[];
      prevalidation: OrderPrevalidation;
    };

/**
 * Client mirror of the order-modify request body (`POST /api/orders/{id}/modify`).
 * The original order is identified by the path id, so no `symbol` is carried.
 * `price` is required for LIMIT and forbidden for MARKET; `confirm` is read only
 * from the body, so omitting it yields a DRY_RUN preview.
 */
export interface OrderModifyBody {
  orderType: "LIMIT" | "MARKET";
  quantity?: string;
  price?: string;
  confirmHighValueOrder?: boolean;
  confirm?: boolean;
}

/**
 * Client mirror of the `POST /api/orders/{id}/modify` success payload. The §6
 * safety gate decides the `status`.
 *   - DRY_RUN: preview only — `wouldSend` echoes the would-be modify body.
 *   - SENT: a real modify was issued — `response.orderId` is the new server id.
 *   - BLOCKED: a guard refused the modify — `reasons` lists why.
 */
export type ModifyOrderResult =
  | {
      status: "DRY_RUN";
      wouldSend: OrderModifyBody;
      reasons: string[];
    }
  | {
      status: "SENT";
      response: { orderId: string };
      notionalKrw: number;
    }
  | {
      status: "BLOCKED";
      request: OrderModifyBody;
      reasons: string[];
    };

/**
 * Client mirror of the `POST /api/orders/{id}/cancel` success payload. The §6
 * safety gate decides the `status`.
 *   - DRY_RUN: preview only — the cancel was not sent.
 *   - SENT: a real cancel was issued — `response.orderId` is the new server id.
 *   - BLOCKED: a guard refused the cancel — `reasons` lists why.
 */
export type CancelOrderResult =
  | {
      status: "DRY_RUN";
      orderId: string;
      reasons: string[];
    }
  | {
      status: "SENT";
      response: { orderId: string };
    }
  | {
      status: "BLOCKED";
      orderId: string;
      reasons: string[];
    };

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

export interface Trade {
  price: string;
  volume: string;
  timestamp: string;
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

/**
 * Client mirror of the server `NewsItem` (`lib/server/news/types.ts`). A recent
 * article for the selected symbol, shown on the dashboard news card.
 */
export interface NewsArticle {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}
