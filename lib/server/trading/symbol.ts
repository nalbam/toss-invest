import "server-only";

/**
 * True for KRX (Korea) symbols, which trade in KRW. KRX short codes are 6
 * characters that start with a digit: most are all-digits (e.g. `005930`), but
 * newer codes embed an uppercase letter (e.g. the ETF `0167A0`). US tickers
 * (e.g. `AAPL`) start with a letter and trade in USD.
 *
 * Single source of truth for the currency predicate used by the §6 gate
 * (`safety.ts`), the gate-context builder (`context.ts`), the auto-trader, and
 * the orders route, so they can never drift out of sync.
 */
export function isKrwSymbol(symbol: string): boolean {
  return /^\d[0-9A-Z]{5}$/.test(symbol);
}
