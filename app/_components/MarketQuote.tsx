"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchOlderCandles,
  useCandles,
  useMarketAdvisorHistory,
  useOrderbook,
  usePriceLimits,
  usePrices,
  useTrades,
} from "@/lib/client/hooks";
import type { Candle, Order } from "@/lib/client/types";
import {
  advisorSourceCandleCount,
  aggregateCandles,
  CHART_INTERVALS,
  combineCandlePages,
  DAY_CHART_INTERVALS,
  isMinuteInterval,
  MINUTE_CHART_INTERVALS,
  sourceInterval,
  type ChartInterval,
} from "@/lib/client/candles";
import { collectSourceCandles } from "@/lib/client/market-advisor";
import { summarizeTrend } from "@/lib/client/indicators";
import { formatKrw, formatPercent, formatUsd, signOf } from "@/lib/client/format";
import { previousClose, priceChange } from "@/lib/client/quote";
import {
  addFavoriteItem,
  removeFavoriteItem,
  useFavorites,
} from "@/lib/client/favorites";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import { CandleChart, toOrderMarkers } from "./CandleChart";
import { MarketAiAdvisor } from "./MarketAiAdvisor";
import { Orderbook } from "./Orderbook";
import { OrderbookDepth } from "./OrderbookDepth";
import { TradesChart } from "./TradesChart";
import { readStoredJson, writeStoredJson } from "./localStorageJson";
import { getStoredItem, setStoredItem } from "./settingsStore";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

const CHART_INTERVAL_KEY = "toss-invest:chart-interval";
const CHART_OVERLAYS_KEY = "toss-invest:chart-overlays";

// Backfilled source candles cached per (symbol, source) for the lifetime of the
// page. Returning to a previously viewed symbol restores its full window
// instantly, so the chart never flashes the handful of bars a single live page
// yields before backfill re-lands. Session-only (cleared on reload).
const backfillCache = new Map<string, Candle[]>();

/** Clears the in-memory backfill cache. Exposed for test isolation. */
export function __clearBackfillCache(): void {
  backfillCache.clear();
}

interface ChartOverlayState {
  labels: boolean;
  lines: boolean;
  advice: boolean;
}

function isChartOverlayState(value: unknown): value is ChartOverlayState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const state = value as Partial<ChartOverlayState>;
  return (
    typeof state.labels === "boolean" &&
    typeof state.lines === "boolean" &&
    typeof state.advice === "boolean"
  );
}
const DEFAULT_TITLE = "토스증권 대시보드";

/** Formats a price in the given trading currency. */
function formatPrice(value: string | null, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/** Maps a decimal sign to the matching color class. */
function signClass(value: string | null | undefined): string {
  return styles[signOf(value)];
}

function isChartInterval(value: string | null): value is ChartInterval {
  return CHART_INTERVALS.some((item) => item.value === value);
}

function readStoredInterval(): ChartInterval {
  try {
    const stored = getStoredItem(CHART_INTERVAL_KEY);
    return isChartInterval(stored) ? stored : "1d";
  } catch {
    return "1d";
  }
}

function writeStoredInterval(interval: ChartInterval): void {
  try {
    setStoredItem(CHART_INTERVAL_KEY, interval);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function readStoredOverlays(): ChartOverlayState {
  return (
    readStoredJson(CHART_OVERLAYS_KEY, isChartOverlayState) ?? {
      labels: true,
      lines: true,
      advice: true,
    }
  );
}

/**
 * Market quote section for the selected symbol: its name/last price header, a
 * candlestick chart, the orderbook, and the daily price limits.
 * The symbol is controlled by the parent (driven by the holdings selection),
 * not an in-component input. `name` is shown in the header when known.
 */
export function MarketQuote({
  symbol,
  name,
  orders = [],
  averagePurchasePrice,
  quantity,
}: {
  symbol: string;
  name?: string;
  orders?: Order[];
  averagePurchasePrice?: string;
  quantity?: string;
}) {
  const [interval, setIntervalState] = useState<ChartInterval>(() =>
    readStoredInterval(),
  );
  const [overlays, setOverlays] = useState<ChartOverlayState>(() =>
    readStoredOverlays(),
  );
  // Older candles auto-loaded as the user scrolls the chart back, keyed to the
  // current symbol + source interval. The latest page still comes from SWR below.
  const source = sourceInterval(interval);
  const [olderCandles, setOlderCandles] = useState<Candle[]>([]);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const loadingOlderRef = useRef(false);
  // Initial backfill bookkeeping. `backfillGen` bumps once the interval-sized
  // source window has loaded, to force a single chart re-fit (via fitKey).
  // `backfilledSourceRef` records what was already collected so the same
  // (symbol, source) isn't re-fetched, and only larger intervals top up.
  // Kept separate from `loadingOlderRef` so an in-flight backfill never
  // suppresses scroll-driven `loadOlder`.
  const [backfillGen, setBackfillGen] = useState(0);
  const backfilledSourceRef = useRef<{ key: string; count: number }>({
    key: "",
    count: 0,
  });
  // Whether the current (symbol, source) has data ready to fit to: a cache hit,
  // or a finished backfill attempt (success or empty). The chart stays hidden
  // behind the loading state until this is true, so it never fits to a partial
  // live-page-only window and then jumps when the full window arrives.
  const [backfillSettled, setBackfillSettled] = useState(false);

  // Older pages are keyed to (symbol, source). Reset them during render — not in
  // an effect — when the key changes, so a stale page from the previous interval
  // never mixes into the new source series for a render (which would distort the
  // aggregated chart and misplace the view on an interval switch). React re-runs
  // the render with the cleared state before committing.
  const olderKey = `${symbol}:${source}`;
  const [olderKeyState, setOlderKeyState] = useState(olderKey);
  if (olderKeyState !== olderKey) {
    setOlderKeyState(olderKey);
    // Restore this key's previously backfilled window from the cache instead of
    // emptying it. A cache hit means the full window is available immediately —
    // the chart fits to it in one pass, skipping the transient few-bar view.
    const cached = backfillCache.get(olderKey) ?? [];
    setOlderCandles(cached);
    setOlderExhausted(false);
    loadingOlderRef.current = false;
    // Restore the backfill record from the cache: a hit counts as already
    // filled (so the effect below can skip), a miss resets it so backfill runs.
    backfilledSourceRef.current =
      cached.length > 0
        ? { key: olderKey, count: cached.length }
        : { key: "", count: 0 };
    // A hit can fit immediately; a miss must wait for backfill before showing.
    setBackfillSettled(cached.length > 0);
  }

  const prices = usePrices([symbol]);
  const limits = usePriceLimits(symbol);
  const orderbook = useOrderbook(symbol);
  const trades = useTrades(symbol);
  const orderMarkers = useMemo(
    () => toOrderMarkers(orders, symbol),
    [orders, symbol],
  );
  const candles = useCandles(symbol, source);
  const marketAdvisorHistory = useMarketAdvisorHistory(symbol, interval);
  // Daily candles power the header's day change (vs previous close), regardless
  // of the chart's selected interval.
  const dailyCandles = useCandles(symbol, "1d");

  const quote = prices.data?.[0];
  const currency = quote?.currency ?? "KRW";
  const favorites = useFavorites();
  const isFavorite = favorites.items.some((item) => item.symbol === symbol);

  async function toggleFavorite() {
    try {
      if (isFavorite) {
        await removeFavoriteItem(symbol);
      } else {
        await addFavoriteItem({ symbol, name, currency });
      }
      await favorites.mutate();
    } catch {
      // Best-effort star toggle; SWR revalidation keeps the state consistent.
    }
  }
  const change = priceChange(
    quote?.lastPrice,
    previousClose(dailyCandles.data?.candles ?? []),
  );
  const sourceCandles = candles.data?.candles;
  const dailyCandleList = dailyCandles.data?.candles;
  // Older pages + the latest live page, deduped into one ascending source series
  // before aggregation, so scrolling back extends the chart through history.
  const mergedSourceCandles = useMemo(
    () => combineCandlePages(olderCandles, sourceCandles ?? []),
    [olderCandles, sourceCandles],
  );
  const chartCandles = useMemo(
    () => aggregateCandles(mergedSourceCandles, interval),
    [mergedSourceCandles, interval],
  );

  // Auto-load (no button): the chart calls this when scrolled near the oldest
  // bar. A ref guards against the rapid-fire scroll events triggering concurrent
  // fetches; `olderExhausted` stops once Toss has no more history.
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || olderExhausted) {
      return;
    }
    const oldest = mergedSourceCandles[0];
    if (oldest === undefined) {
      return;
    }
    loadingOlderRef.current = true;
    try {
      const older = await fetchOlderCandles(symbol, source, oldest.timestamp);
      if (older.candles.length === 0) {
        setOlderExhausted(true);
        return;
      }
      setOlderCandles((prev) => combineCandlePages(older.candles, prev));
      if (older.nextBefore === null) {
        setOlderExhausted(true);
      }
    } catch {
      // Best-effort: leave state unchanged so the next scroll retries.
    } finally {
      loadingOlderRef.current = false;
    }
  }, [mergedSourceCandles, symbol, source, olderExhausted]);

  // Initial backfill: pull an interval-appropriate window of source candles so
  // larger intervals (30m/60m/일+) fill the screen on first load instead of the
  // handful of bars a single live page yields. Seeds the same `olderCandles`
  // state the scroll-pagination uses, so the merge/aggregate path is unchanged;
  // bumps `backfillGen` to trigger one re-fit (via `fitKey`) once data lands.
  // Sized by interval but keyed by (symbol, source): 30m↔60m (same 1m source,
  // same cap) skips a refetch, while 5m→10m tops up to the larger target.
  useEffect(() => {
    const desired = advisorSourceCandleCount(interval);
    const already = backfilledSourceRef.current;
    if (already.key === olderKey && already.count >= desired) {
      // Already filled (e.g. restored from cache): nothing to fetch, but the
      // chart is ready to fit.
      setBackfillSettled(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const collected = await collectSourceCandles(symbol, interval).catch(
        () => [] as Candle[],
      );
      if (cancelled) {
        return;
      }
      if (collected.length > 0) {
        backfilledSourceRef.current = {
          key: olderKey,
          count: Math.max(already.count, collected.length),
        };
        setOlderCandles((prev) => combineCandlePages(collected, prev));
        setBackfillGen((generation) => generation + 1);
      }
      // Settle even on an empty result so the chart shows the live page (all
      // the data there is) instead of staying on the loader indefinitely.
      setBackfillSettled(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, olderKey]);

  // Keep the cache in sync with whatever older window is loaded — from backfill
  // or scroll pagination — so returning to this symbol restores it (including
  // any history the user scrolled into) without a refetch.
  useEffect(() => {
    if (olderCandles.length > 0) {
      backfillCache.set(olderKey, olderCandles);
    }
  }, [olderCandles, olderKey]);

  const titleName = name ?? symbol;
  const titlePrice = quote ? formatPrice(quote.lastPrice, currency) : "시세";
  const titleRate = quote ? (change ? formatPercent(change.rate) : "-") : "-";
  const marketAdvisorInput = useMemo(
    () => ({
      symbol,
      name,
      interval,
      currency,
      lastPrice: quote?.lastPrice,
      candles: chartCandles,
      position:
        averagePurchasePrice && quantity
          ? { quantity, averagePrice: averagePurchasePrice }
          : undefined,
      // Sub-daily charts get the daily trend as higher-timeframe context; daily+
      // charts are already their own highest timeframe (matches the worker).
      higherTimeframeTrend:
        sourceInterval(interval) === "1m"
          ? summarizeTrend(dailyCandleList ?? [], "1d") ?? undefined
          : undefined,
    }),
    [
      averagePurchasePrice,
      chartCandles,
      currency,
      dailyCandleList,
      interval,
      name,
      quantity,
      quote?.lastPrice,
      symbol,
    ],
  );

  function setInterval(interval: ChartInterval) {
    setIntervalState(interval);
    writeStoredInterval(interval);
  }

  const toggleOverlay = useCallback((key: keyof ChartOverlayState) => {
    setOverlays((current) => {
      const next = { ...current, [key]: !current[key] };
      writeStoredJson(CHART_OVERLAYS_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.title = `${titlePrice} ${titleRate} ${titleName}`;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [titleName, titlePrice, titleRate]);

  return (
    <CollapsibleCard title="시세" storageId="market-quote">
      <div className={styles.quoteHeadline}>
        <span className={styles.metricLabel}>
          {name ? `${name} (${symbol})` : `현재가 (${symbol})`}
        </span>
        <button
          type="button"
          className={styles.favoriteStar}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          title={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          onClick={() => void toggleFavorite()}
        >
          {isFavorite ? "★" : "☆"}
        </button>
        {prices.isLoading ? (
          <span className={styles.metricSecondary}>불러오는 중…</span>
        ) : prices.error ? (
          <span className={`${styles.metricSecondary} ${styles.negative}`}>
            {prices.error.message}
          </span>
        ) : quote ? (
          <>
            <span className={styles.metricPrimary}>
              <Money value={formatPrice(quote.lastPrice, currency)} />
            </span>
            {change ? (
              <span
                className={`${styles.metricChange} ${signClass(change.amount)}`}
              >
                <Money value={formatPrice(change.amount, currency)} /> (
                {formatPercent(change.rate)})
              </span>
            ) : null}
          </>
        ) : (
          <span className={styles.metricSecondary}>-</span>
        )}
      </div>

      <div className={`${page.controls} ${styles.chartControls}`}>
        <span className={page.controlLabel}>차트</span>
        <select
          className={`${page.select} ${isMinuteInterval(interval) ? styles.activeControl : ""}`}
          aria-label="분봉 단위"
          value={isMinuteInterval(interval) ? interval : ""}
          onChange={(event) => setInterval(event.target.value as ChartInterval)}
        >
          <option value="" disabled>
            분
          </option>
          {MINUTE_CHART_INTERVALS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {DAY_CHART_INTERVALS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`${page.select} ${interval === item.value ? styles.activeControl : ""}`}
            aria-pressed={interval === item.value}
            onClick={() => setInterval(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {candles.isLoading || (!backfillSettled && candles.data) ? (
        // Hold the loader until the full window is ready (cache hit or finished
        // backfill), so the chart fits to it directly instead of flashing the
        // few bars a single live page yields and then jumping.
        <p className={page.status}>차트를 불러오는 중…</p>
      ) : candles.error ? (
        <p className={`${page.status} ${page.error}`} role="alert">
          차트를 불러오지 못했습니다: {candles.error.message}
        </p>
      ) : candles.data ? (
        <>
          <CandleChart
            candles={chartCandles}
            fitKey={`${symbol}:${interval}:${backfillGen}`}
            onReachStart={loadOlder}
            priceLimits={limits.data}
            markers={orderMarkers}
            averagePurchasePrice={averagePurchasePrice}
            annotations={marketAdvisorHistory.data?.events[0]?.annotations}
            advisorEvents={marketAdvisorHistory.data?.events ?? []}
            showAnnotationLabels={overlays.labels}
            showAnnotationLines={overlays.lines}
            showAdviceLines={overlays.advice}
          />
          <MarketAiAdvisor
            input={marketAdvisorInput}
            chartOverlay={{
              showLabels: overlays.labels,
              showLines: overlays.lines,
              showAdvice: overlays.advice,
              onToggleLabels: () => toggleOverlay("labels"),
              onToggleLines: () => toggleOverlay("lines"),
              onToggleAdvice: () => toggleOverlay("advice"),
            }}
          />
        </>
      ) : null}

      {trades.data && trades.data.length > 0 ? (
        <TradesChart
          trades={trades.data}
          refreshing={Boolean(trades.isRefreshing)}
        />
      ) : null}

      {orderbook.isLoading ? (
        <p className={page.status}>호가를 불러오는 중…</p>
      ) : orderbook.error ? (
        <p className={`${page.status} ${page.error}`} role="alert">
          호가를 불러오지 못했습니다: {orderbook.error.message}
        </p>
      ) : orderbook.data ? (
        <>
          <Orderbook book={orderbook.data} />
          <OrderbookDepth book={orderbook.data} />
        </>
      ) : null}
    </CollapsibleCard>
  );
}
