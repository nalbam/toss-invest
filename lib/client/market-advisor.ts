import { isErrorEnvelope, isSuccessEnvelope } from "./envelope";
import { ApiClientError } from "./hooks";
import type { Candle, Currency } from "./types";

export interface MarketAdvisorInput {
  symbol: string;
  name?: string;
  interval: string;
  currency: Currency;
  lastPrice?: string;
  candles: Candle[];
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
