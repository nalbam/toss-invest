import "server-only";
import { z } from "zod";

/**
 * Decimal money/quantity fields are kept as strings. Parsing them into JS
 * numbers would silently lose precision (e.g. large quantities, fractional
 * shares), so every `format: decimal` field stays a `z.string()`.
 */
const decimal = z.string();

/**
 * Enum fields may receive values the spec does not yet list. The OpenAPI doc
 * explicitly states clients must accept unknown enum values, so each enum is a
 * union of the known literals with an open `z.string()` fallback. The inferred
 * type stays useful (`"KRW" | "USD" | (string & {})`-like) while never
 * rejecting an unexpected value.
 */
function openEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.union([
    ...values.map((value) => z.literal(value)),
    z.string(),
  ] as unknown as [z.ZodLiteral<T[number]>, z.ZodString]);
}

export const currencySchema = openEnum(["KRW", "USD"]);
export const marketCountrySchema = openEnum(["KR", "US"]);
export const accountTypeSchema = openEnum([
  "BROKERAGE",
  "OVERSEAS_DERIVATIVES",
  "PENSION_SAVINGS",
  "RESHORING_INVESTMENT",
]);
export const rateChangeTypeSchema = openEnum(["UP", "EQUAL", "DOWN"]);
export const orderSideSchema = openEnum(["BUY", "SELL"]);
export const orderTypeSchema = openEnum(["LIMIT", "MARKET"]);
export const timeInForceSchema = openEnum(["DAY", "CLS", "OPG"]);
export const orderStatusSchema = openEnum([
  "PENDING",
  "PENDING_CANCEL",
  "PENDING_REPLACE",
  "PARTIAL_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "CANCEL_REJECTED",
  "REPLACE_REJECTED",
  "REPLACED",
]);

/** Success envelope: `{ result: T }`. */
export function apiResponse<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({ result: resultSchema });
}

/** Error envelope: `{ error: { requestId, code, message, data? } }`. */
export const errorResponseSchema = z.object({
  error: z.object({
    requestId: z.string(),
    code: z.string(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// --- accounts ---------------------------------------------------------------

export const accountSchema = z.object({
  accountNo: z.string(),
  accountSeq: z.number(),
  accountType: accountTypeSchema,
});
export type Account = z.infer<typeof accountSchema>;

export const accountsResultSchema = z.array(accountSchema);

// --- holdings ---------------------------------------------------------------

export const priceSchema = z.object({
  krw: decimal,
  usd: decimal.nullable(),
});
export type Price = z.infer<typeof priceSchema>;

export const overviewMarketValueSchema = z.object({
  amount: priceSchema,
  amountAfterCost: priceSchema,
});

export const overviewProfitLossSchema = z.object({
  amount: priceSchema,
  amountAfterCost: priceSchema,
  rate: decimal,
  rateAfterCost: decimal,
});

export const overviewDailyProfitLossSchema = z.object({
  amount: priceSchema,
  rate: decimal,
});

export const marketValueSchema = z.object({
  purchaseAmount: decimal,
  amount: decimal,
  amountAfterCost: decimal,
});

export const profitLossSchema = z.object({
  amount: decimal,
  amountAfterCost: decimal,
  rate: decimal,
  rateAfterCost: decimal,
});

export const dailyProfitLossSchema = z.object({
  amount: decimal,
  rate: decimal,
});

export const costSchema = z.object({
  commission: decimal,
  tax: decimal.nullable(),
});
export type Cost = z.infer<typeof costSchema>;

export const holdingsItemSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  marketCountry: marketCountrySchema,
  currency: currencySchema,
  quantity: decimal,
  lastPrice: decimal,
  averagePurchasePrice: decimal,
  marketValue: marketValueSchema,
  profitLoss: profitLossSchema,
  dailyProfitLoss: dailyProfitLossSchema,
  cost: costSchema,
});
export type HoldingsItem = z.infer<typeof holdingsItemSchema>;

export const holdingsOverviewSchema = z.object({
  totalPurchaseAmount: priceSchema,
  marketValue: overviewMarketValueSchema,
  profitLoss: overviewProfitLossSchema,
  dailyProfitLoss: overviewDailyProfitLossSchema,
  items: z.array(holdingsItemSchema),
});
export type HoldingsOverview = z.infer<typeof holdingsOverviewSchema>;

// --- prices -----------------------------------------------------------------

export const priceResponseSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().nullable().optional(),
  lastPrice: decimal,
  currency: currencySchema,
});
export type PriceResponse = z.infer<typeof priceResponseSchema>;

export const pricesResultSchema = z.array(priceResponseSchema);

// --- orderbook --------------------------------------------------------------

export const orderbookEntrySchema = z.object({
  price: decimal,
  volume: decimal,
});
export type OrderbookEntry = z.infer<typeof orderbookEntrySchema>;

export const orderbookResponseSchema = z.object({
  timestamp: z.string().nullable(),
  currency: currencySchema,
  asks: z.array(orderbookEntrySchema),
  bids: z.array(orderbookEntrySchema),
});
export type OrderbookResponse = z.infer<typeof orderbookResponseSchema>;

// --- trades -----------------------------------------------------------------

export const tradeSchema = z.object({
  price: decimal,
  volume: decimal,
  timestamp: z.string(),
  currency: currencySchema,
});
export type Trade = z.infer<typeof tradeSchema>;

export const tradesResultSchema = z.array(tradeSchema);

// --- price-limits -----------------------------------------------------------

export const priceLimitResponseSchema = z.object({
  timestamp: z.string(),
  upperLimitPrice: decimal.nullable(),
  lowerLimitPrice: decimal.nullable(),
  currency: currencySchema,
});
export type PriceLimitResponse = z.infer<typeof priceLimitResponseSchema>;

// --- candles ----------------------------------------------------------------

export const candleSchema = z.object({
  timestamp: z.string(),
  openPrice: decimal,
  highPrice: decimal,
  lowPrice: decimal,
  closePrice: decimal,
  volume: decimal,
  currency: currencySchema,
});
export type Candle = z.infer<typeof candleSchema>;

export const candlePageResponseSchema = z.object({
  candles: z.array(candleSchema),
  nextBefore: z.string().nullable(),
});
export type CandlePageResponse = z.infer<typeof candlePageResponseSchema>;

// --- exchange-rate ----------------------------------------------------------

export const exchangeRateResponseSchema = z.object({
  baseCurrency: currencySchema,
  quoteCurrency: currencySchema,
  rate: decimal,
  midRate: decimal,
  basisPoint: decimal,
  rateChangeType: rateChangeTypeSchema,
  validFrom: z.string(),
  validUntil: z.string(),
});
export type ExchangeRateResponse = z.infer<typeof exchangeRateResponseSchema>;

// --- orders -----------------------------------------------------------------

export const orderExecutionSchema = z.object({
  filledQuantity: decimal,
  averageFilledPrice: decimal.nullable(),
  filledAmount: decimal.nullable(),
  commission: decimal.nullable(),
  tax: decimal.nullable(),
  filledAt: z.string().nullable(),
  settlementDate: z.string().nullable(),
});
export type OrderExecution = z.infer<typeof orderExecutionSchema>;

export const orderSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: orderSideSchema,
  orderType: orderTypeSchema,
  timeInForce: timeInForceSchema,
  status: orderStatusSchema,
  price: decimal.nullable(),
  quantity: decimal,
  orderAmount: decimal.nullable(),
  currency: currencySchema,
  orderedAt: z.string(),
  canceledAt: z.string().nullable(),
  execution: orderExecutionSchema,
});
export type Order = z.infer<typeof orderSchema>;

export const paginatedOrderResponseSchema = z.object({
  orders: z.array(orderSchema),
  nextCursor: z.string().nullable(),
  hasNext: z.boolean(),
});
export type PaginatedOrderResponse = z.infer<
  typeof paginatedOrderResponseSchema
>;

// --- stocks -----------------------------------------------------------------

export const stockMarketSchema = openEnum([
  "KOSPI",
  "KOSDAQ",
  "NYSE",
  "NASDAQ",
  "AMEX",
  "KR_ETC",
  "US_ETC",
]);
export const securityTypeSchema = openEnum([
  "STOCK",
  "FOREIGN_STOCK",
  "DEPOSITARY_RECEIPT",
  "INFRASTRUCTURE_FUND",
  "REIT",
  "ETF",
  "FOREIGN_ETF",
  "ETN",
  "STOCK_WARRANTS",
]);
export const stockStatusSchema = openEnum([
  "SCHEDULED",
  "ACTIVE",
  "DELISTED",
]);

export const krMarketDetailSchema = z.object({
  liquidationTrading: z.boolean(),
  nxtSupported: z.boolean(),
  krxTradingSuspended: z.boolean(),
  nxtTradingSuspended: z.boolean().nullable().optional(),
});
export type KrMarketDetail = z.infer<typeof krMarketDetailSchema>;

export const stockInfoSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  englishName: z.string(),
  isinCode: z.string(),
  market: stockMarketSchema,
  securityType: securityTypeSchema,
  isCommonShare: z.boolean(),
  status: stockStatusSchema,
  currency: currencySchema,
  listDate: z.string().nullable().optional(),
  delistDate: z.string().nullable().optional(),
  sharesOutstanding: decimal,
  leverageFactor: decimal.nullable().optional(),
  koreanMarketDetail: krMarketDetailSchema.nullable().optional(),
});
export type StockInfo = z.infer<typeof stockInfoSchema>;

export const stocksResultSchema = z.array(stockInfoSchema);

// --- stock warnings ---------------------------------------------------------

export const warningTypeSchema = openEnum([
  "LIQUIDATION_TRADING",
  "OVERHEATED",
  "INVESTMENT_WARNING",
  "INVESTMENT_RISK",
  "VI_STATIC_AND_DYNAMIC",
  "VI_STATIC",
  "VI_DYNAMIC",
  "STOCK_WARRANTS",
]);

export const stockWarningSchema = z.object({
  warningType: warningTypeSchema,
  exchange: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});
export type StockWarning = z.infer<typeof stockWarningSchema>;

export const stockWarningsResultSchema = z.array(stockWarningSchema);

// --- market-calendar (KR) ---------------------------------------------------

export const preMarketSessionSchema = z.object({
  startTime: z.string(),
  singlePriceAuctionStartTime: z.string().nullable().optional(),
  endTime: z.string(),
});

export const regularMarketSessionSchema = z.object({
  startTime: z.string(),
  singlePriceAuctionStartTime: z.string().nullable().optional(),
  endTime: z.string(),
});

export const afterMarketSessionSchema = z.object({
  startTime: z.string(),
  singlePriceAuctionEndTime: z.string().nullable().optional(),
  endTime: z.string(),
});

export const integratedHourSchema = z.object({
  preMarket: preMarketSessionSchema.nullable().optional(),
  regularMarket: regularMarketSessionSchema.nullable().optional(),
  afterMarket: afterMarketSessionSchema.nullable().optional(),
});

export const krMarketDaySchema = z.object({
  date: z.string(),
  integrated: integratedHourSchema.nullable().optional(),
});
export type KrMarketDay = z.infer<typeof krMarketDaySchema>;

export const krMarketCalendarResponseSchema = z.object({
  today: krMarketDaySchema,
  previousBusinessDay: krMarketDaySchema,
  nextBusinessDay: krMarketDaySchema,
});
export type KrMarketCalendarResponse = z.infer<
  typeof krMarketCalendarResponseSchema
>;

// --- market-calendar (US) ---------------------------------------------------

export const usDayMarketSessionSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
});

export const usPreMarketSessionSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
});

export const usRegularMarketSessionSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
});

export const usAfterMarketSessionSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
});

export const usMarketDaySchema = z.object({
  date: z.string(),
  dayMarket: usDayMarketSessionSchema.nullable().optional(),
  preMarket: usPreMarketSessionSchema.nullable().optional(),
  regularMarket: usRegularMarketSessionSchema.nullable().optional(),
  afterMarket: usAfterMarketSessionSchema.nullable().optional(),
});
export type UsMarketDay = z.infer<typeof usMarketDaySchema>;

export const usMarketCalendarResponseSchema = z.object({
  today: usMarketDaySchema,
  previousBusinessDay: usMarketDaySchema,
  nextBusinessDay: usMarketDaySchema,
});
export type UsMarketCalendarResponse = z.infer<
  typeof usMarketCalendarResponseSchema
>;

// --- buying-power -----------------------------------------------------------

export const buyingPowerResponseSchema = z.object({
  currency: currencySchema,
  cashBuyingPower: decimal,
});
export type BuyingPowerResponse = z.infer<typeof buyingPowerResponseSchema>;

// --- sellable-quantity ------------------------------------------------------

export const sellableQuantityResponseSchema = z.object({
  sellableQuantity: decimal,
});
export type SellableQuantityResponse = z.infer<
  typeof sellableQuantityResponseSchema
>;

// --- commissions ------------------------------------------------------------

export const commissionSchema = z.object({
  marketCountry: marketCountrySchema,
  commissionRate: decimal,
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});
export type Commission = z.infer<typeof commissionSchema>;

export const commissionsResultSchema = z.array(commissionSchema);
