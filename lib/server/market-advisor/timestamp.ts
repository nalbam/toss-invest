import "server-only";
import type { MarketAdvisorRequest } from "./schema";

// Resolves the newest candle timestamp for history bookkeeping. Pure + order-
// independent: candles may arrive in any order, so the latest is found by parsed
// epoch milliseconds rather than array position.

/** Parses a candle timestamp (epoch seconds/millis or ISO) to epoch ms, or null. */
export function timestampMs(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return trimmed.length >= 13 ? num : num * 1000;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

/** Returns the timestamp string of the newest candle, or null if none parse. */
export function latestCandleTimestamp(
  request: Pick<MarketAdvisorRequest, "candles">,
): string | null {
  let latest: { timestamp: string; ms: number } | null = null;
  for (const candle of request.candles) {
    const ms = timestampMs(candle.timestamp);
    if (ms === null) {
      continue;
    }
    if (latest === null || ms > latest.ms) {
      latest = { timestamp: candle.timestamp, ms };
    }
  }
  return latest?.timestamp ?? null;
}
