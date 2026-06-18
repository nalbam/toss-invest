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
