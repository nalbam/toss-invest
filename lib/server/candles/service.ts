import "server-only";
import type Database from "better-sqlite3";
import {
  advisorSourceCandleCount,
  aggregateForAdvisor,
  sourceInterval,
  type ChartInterval,
} from "@/lib/client/candles";
import { getDb } from "@/lib/server/db/sqlite";
import type { Candle, CandlePageResponse } from "@/lib/server/toss/schemas";
import type { GetCandlesParams } from "@/lib/server/toss/endpoints";
import {
  putConfirmedCandles,
  readCachedCandles,
  type SourceInterval,
} from "./cache";

// Cache-backed candle reads. Confirmed (closed) candles are served from the
// local cache when available; the still-forming candle and any cache gaps are
// fetched live from Toss (and the confirmed part of each live page is cached).

/** Page size used for cache-vs-Toss decisions when the caller omits `count`. */
export const DEFAULT_PAGE_COUNT = 200;

/** The single Toss method this layer needs — narrowed for easy stubbing. */
export interface CandleFetcher {
  getCandles(params: GetCandlesParams): Promise<CandlePageResponse>;
}

export interface CandleServiceDeps {
  client: CandleFetcher;
  db?: Database.Database;
  /** Injectable clock (epoch ms) for deterministic confirmed-candle decisions. */
  now?: () => number;
}

export interface GetCandlesCachedParams {
  symbol: string;
  interval: SourceInterval;
  count?: number;
  before?: string;
  adjusted?: boolean;
}

/**
 * Returns a page of candles `{ candles, nextBefore }`, transparently backed by
 * the local cache:
 * - Latest page (no `before`): always fetched live from Toss so the forming
 *   candle is current; the page's confirmed candles are written to the cache.
 * - Older page (`before` set): served from the cache when it holds a full page
 *   strictly older than the cursor (those are all confirmed, so safe); otherwise
 *   fetched live (filling the gap) and the confirmed candles are cached.
 */
export async function getCandlesCached(
  params: GetCandlesCachedParams,
  deps: CandleServiceDeps,
): Promise<CandlePageResponse> {
  const db = deps.db ?? getDb();
  const nowMs = deps.now?.() ?? Date.now();

  if (params.before !== undefined) {
    const limit = params.count ?? DEFAULT_PAGE_COUNT;
    const cached = readCachedCandles(
      params.symbol,
      params.interval,
      { before: params.before, limit },
      db,
    );
    if (cached.length >= limit) {
      const oldest = cached[cached.length - 1];
      return { candles: cached, nextBefore: oldest.timestamp };
    }
  }

  const page = await deps.client.getCandles({
    symbol: params.symbol,
    interval: params.interval,
    count: params.count,
    before: params.before,
    adjusted: params.adjusted,
  });
  putConfirmedCandles(params.symbol, params.interval, page.candles, nowMs, db);
  return page;
}

/**
 * Collects an interval-appropriate candle window for the background chart advisor
 * (worker): paginates the cache-backed source candles until it has
 * `advisorSourceCandleCount(interval)` of them, then aggregates and keeps the most
 * recent `ADVISOR_TARGET_BARS` bars. Mirrors the client `loadAdvisorCandles` so a
 * 10m chart is analyzed on enough ten-minute bars rather than the single page.
 */
export async function collectAdvisorCandles(
  symbol: string,
  interval: ChartInterval,
  deps: CandleServiceDeps,
): Promise<Candle[]> {
  const source = sourceInterval(interval);
  const desired = advisorSourceCandleCount(interval);
  const collected: Candle[] = [];
  let before: string | undefined;
  while (collected.length < desired) {
    const page = await getCandlesCached(
      { symbol, interval: source, before, count: 200 },
      deps,
    );
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
