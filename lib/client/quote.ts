import { addDecimalStrings } from "./format";
import type { Candle } from "./types";

/**
 * Previous-session close from a list of daily candles: the close of the bar just
 * before the most recent one. Returns undefined when there are fewer than two
 * candles. Input order doesn't matter — candles are sorted by timestamp first.
 */
export function previousClose(candles: Candle[]): string | undefined {
  if (candles.length < 2) return undefined;
  const sorted = [...candles].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  return sorted[sorted.length - 2]?.closePrice;
}

/**
 * Day change of `lastPrice` vs the previous session close: the precise change
 * amount (decimal string, sign preserved) and the change ratio for
 * `formatPercent`. Returns null when it can't be computed (missing inputs or a
 * zero/invalid previous close). The amount stays string-precise; the ratio is a
 * float since it is only ever rendered as a 2-decimal percentage.
 */
export function priceChange(
  lastPrice: string | null | undefined,
  prevClose: string | undefined,
): { amount: string; rate: string } | null {
  if (!lastPrice || !prevClose) return null;
  const prev = Number(prevClose);
  const last = Number(lastPrice);
  if (!Number.isFinite(prev) || !Number.isFinite(last) || prev === 0) {
    return null;
  }
  const amount = addDecimalStrings(lastPrice, `-${prevClose}`);
  const rate = String((last - prev) / prev);
  return { amount, rate };
}
