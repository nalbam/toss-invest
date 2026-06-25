import {
  advisorSourceCandleCount,
  aggregateForAdvisor,
  sourceInterval,
  type ChartInterval,
} from "./candles";
import { isErrorEnvelope, isSuccessEnvelope } from "./envelope";
import { ApiClientError, fetchCandlePage } from "./hooks";
import type { TrendSummary } from "./indicators";
import type { Candle, Currency } from "./types";

export interface MarketAdvisorInput {
  symbol: string;
  name?: string;
  interval: string;
  currency: Currency;
  lastPrice?: string;
  candles: Candle[];
  /** Present for held symbols so advice can weigh profit/loss vs. average price. */
  position?: { quantity: string; averagePrice: string };
  /** Present for sub-daily charts so advice can weigh the higher-timeframe trend. */
  higherTimeframeTrend?: TrendSummary;
}

export interface MarketAdvisorResult {
  advice: string;
  decision: MarketAdvisorDecision;
  annotations: MarketChartAnnotations;
  model: string;
  generatedAt: string;
}

export interface MarketAdvisorHistoryEvent {
  symbol: string;
  interval: string;
  generatedAt: string;
  chartTimestamp: string | null;
  lastPrice?: string;
  decision: MarketAdvisorDecision;
  advice: string;
  annotations?: MarketChartAnnotations;
  cachedAt: string;
}

export interface MarketAdvisorDecision {
  action: "buy" | "sell" | "hold" | "wait";
  label: string;
  reason: string;
}

export interface MarketChartAnnotations {
  supportLevels: MarketPriceAnnotation[];
  resistanceLevels: MarketPriceAnnotation[];
  markers: MarketMarkerAnnotation[];
}

export interface MarketPriceAnnotation {
  price: number;
  label: string;
}

export interface MarketMarkerAnnotation {
  timestamp: string;
  position: "aboveBar" | "belowBar" | "inBar";
  label: string;
}

export async function fetchMarketAdvisor(
  input: MarketAdvisorInput,
): Promise<MarketAdvisorResult> {
  const res = await fetch("/api/market-advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unreadable response.",
      status: res.status,
    });
  }

  if (!res.ok || isErrorEnvelope(body)) {
    if (isErrorEnvelope(body)) {
      throw new ApiClientError({
        code: body.error.code,
        message: body.error.message,
        status: res.status,
        requestId: body.error.requestId,
      });
    }
    throw new ApiClientError({
      code: "unexpected-error",
      message: `Request failed with status ${res.status}.`,
      status: res.status,
    });
  }

  if (!isSuccessEnvelope<MarketAdvisorResult>(body)) {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unexpected response shape.",
      status: res.status,
    });
  }
  return body.data;
}

/**
 * Loads an interval-appropriate candle window for the chart advisor, independent
 * of how far the chart is scrolled: a 10m chart needs ~10× more 1m source candles
 * than its visible page to yield enough ten-minute bars for analysis. Paginates
 * the cache-backed `/api/candles` (latest + older via `before`) until it has
 * `advisorSourceCandleCount(interval)` source candles (or runs out), then
 * aggregates and keeps the most recent `ADVISOR_TARGET_BARS` bars.
 */
export async function loadAdvisorCandles(
  symbol: string,
  interval: ChartInterval,
): Promise<Candle[]> {
  const source = sourceInterval(interval);
  const desired = advisorSourceCandleCount(interval);
  const collected: Candle[] = [];
  let before: string | undefined;
  while (collected.length < desired) {
    const page = await fetchCandlePage(symbol, source, { before, count: 200 });
    if (page.candles.length === 0) {
      break;
    }
    collected.push(...page.candles);
    if (page.nextBefore === null) {
      break;
    }
    before = page.nextBefore;
  }
  return aggregateForAdvisor(collected, interval);
}
