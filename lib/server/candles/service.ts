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
  intervalMs,
  isConfirmedCandle,
  parseTimestampMs,
  putConfirmedCandles,
  readCachedCandles,
  readCoverage,
  recordCoverageFetch,
  type SourceInterval,
} from "./cache";

// Cache-backed candle reads. Confirmed (closed) candles are served from the
// local cache when available; the still-forming candle and any cache gaps are
// fetched live from Toss (and the confirmed part of each live page is cached).

/** Page size used for cache-vs-Toss decisions when the caller omits `count`. */
export const DEFAULT_PAGE_COUNT = 200;

/** Candles fetched on a warm latest refresh: the forming candle plus a few
 *  recent confirmed ones. Deliberately a small FIXED probe, not scaled by
 *  elapsed time — a 1m-sourced chart (e.g. a 60m view) left idle for hours would
 *  otherwise balloon the delta to a full page and re-download everything. If the
 *  probe adjoins the cache's newest (no new candles while the market was closed,
 *  or a short poll gap) the confirmed remainder is served from the local DB; a
 *  real gap (long intraday idle / market reopen) falls through to a full fetch. */
const LATEST_PROBE_COUNT = 10;

/** Newest-first merge of the forming candle(s) on top of the cached confirmed
 *  candles, de-duped by timestamp (the live/forming copy wins), capped at
 *  `limit`. Used to assemble a latest page from cache + live delta. */
function mergeLatest(
  forming: Candle[],
  confirmed: Candle[],
  limit: number,
): Candle[] {
  const seen = new Set<string>();
  const out: Candle[] = [];
  for (const c of [...forming, ...confirmed]) {
    if (seen.has(c.timestamp)) {
      continue;
    }
    seen.add(c.timestamp);
    out.push(c);
  }
  out.sort((a, b) => parseTimestampMs(b.timestamp) - parseTimestampMs(a.timestamp));
  return out.slice(0, limit);
}

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
      // Only trust the cached page when the recorded coverage vouches for the
      // whole window between the cursor and the newest candle returned. Without
      // this, a hole in the cache would be silently jumped (the query returns
      // `limit` candles from the far side) and never backfilled from Toss.
      const cov = readCoverage(params.symbol, params.interval, db);
      const oldestMs = parseTimestampMs(cached[cached.length - 1].timestamp);
      const cursorMs = parseTimestampMs(params.before);
      if (cov && cursorMs <= cov.to && oldestMs >= cov.from) {
        const oldest = cached[cached.length - 1];
        return { candles: cached, nextBefore: oldest.timestamp };
      }
      // else: coverage doesn't span this window (hole jumped, or above the
      // proven range) → fall through to a live fetch that fills the gap.
    }
  } else {
    // Latest page (no cursor). A cold cache must fetch the whole page, but a warm
    // one (confirmed candles cached AND coverage vouching for the newest) only
    // needs the delta from Toss: the forming candle plus any candles confirmed
    // since the cache's newest. The confirmed remainder is served from the local
    // DB, so a reload / 20s poll stops re-downloading every confirmed candle.
    //
    // The gate is `length > 0`, NOT `>= limit`: a real latest page's newest
    // candle is still forming, so the cache holds `limit - 1` confirmed candles
    // at most and could never reach `limit` — a `>= limit` gate would never fire.
    const limit = params.count ?? DEFAULT_PAGE_COUNT;
    const cachedLatest = readCachedCandles(
      params.symbol,
      params.interval,
      { limit },
      db,
    );
    const cov = readCoverage(params.symbol, params.interval, db);
    if (cachedLatest.length > 0 && cov !== null) {
      const newestCachedMs = parseTimestampMs(cachedLatest[0].timestamp);
      if (cov.to >= newestCachedMs) {
        const step = intervalMs(params.interval);
        // A small fixed probe — see LATEST_PROBE_COUNT. NOT elapsed-scaled, so a
        // long idle can't turn this into a full-page re-fetch.
        const refreshCount = Math.min(limit, LATEST_PROBE_COUNT);
        const live = await deps.client.getCandles({
          symbol: params.symbol,
          interval: params.interval,
          count: refreshCount,
          adjusted: params.adjusted,
        });
        putConfirmedCandles(params.symbol, params.interval, live.candles, nowMs, db);
        const liveEpochs = live.candles
          .filter((c) => isConfirmedCandle(c.timestamp, params.interval, nowMs))
          .map((c) => parseTimestampMs(c.timestamp));
        const oldestLiveMs =
          liveEpochs.length > 0 ? Math.min(...liveEpochs) : nowMs;
        // Only merge when the live delta overlaps/adjoins the cache's newest —
        // otherwise a gap opened between them (cache too stale for this delta) and
        // we fall through to a full fetch rather than serve a holed page.
        if (oldestLiveMs <= newestCachedMs + step) {
          recordCoverageFetch(
            params.symbol,
            params.interval,
            {
              from: liveEpochs.length > 0 ? oldestLiveMs : newestCachedMs,
              to: nowMs,
              latest: true,
            },
            nowMs,
            db,
          );
          const confirmed = readCachedCandles(
            params.symbol,
            params.interval,
            { limit },
            db,
          );
          const forming = live.candles.filter(
            (c) => !isConfirmedCandle(c.timestamp, params.interval, nowMs),
          );
          const merged = mergeLatest(forming, confirmed, limit);
          const oldest = merged[merged.length - 1];
          return {
            candles: merged,
            nextBefore: oldest ? oldest.timestamp : null,
          };
        }
        // gap → fall through to the full fetch (the live delta is already cached).
      }
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
  // Record the proven-fetched window so future reads can trust this range. A
  // latest fetch (no cursor) proves coverage up to `nowMs`; an older fetch proves
  // it up to the request cursor.
  const epochs = page.candles
    .filter((c) => isConfirmedCandle(c.timestamp, params.interval, nowMs))
    .map((c) => parseTimestampMs(c.timestamp));
  if (epochs.length > 0) {
    recordCoverageFetch(
      params.symbol,
      params.interval,
      {
        from: Math.min(...epochs),
        to:
          params.before === undefined
            ? nowMs
            : parseTimestampMs(params.before),
        latest: params.before === undefined,
      },
      nowMs,
      db,
    );
  }
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
