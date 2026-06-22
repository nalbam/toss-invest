"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useCandles,
  useOrderbook,
  usePriceLimits,
  usePrices,
} from "@/lib/client/hooks";
import {
  aggregateCandles,
  CHART_INTERVALS,
  sourceInterval,
  type ChartInterval,
} from "@/lib/client/candles";
import { formatKrw, formatPercent, formatUsd, signOf } from "@/lib/client/format";
import { previousClose, priceChange } from "@/lib/client/quote";
import type { MarketAdvisorResult } from "@/lib/client/market-advisor";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import { CandleChart } from "./CandleChart";
import { MarketAiAdvisor } from "./MarketAiAdvisor";
import { Orderbook } from "./Orderbook";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

const CHART_INTERVAL_KEY = "toss-invest:chart-interval";
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
    const stored = window.localStorage.getItem(CHART_INTERVAL_KEY);
    return isChartInterval(stored) ? stored : "1d";
  } catch {
    return "1d";
  }
}

function writeStoredInterval(interval: ChartInterval): void {
  try {
    window.localStorage.setItem(CHART_INTERVAL_KEY, interval);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
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
  averagePurchasePrice,
}: {
  symbol: string;
  name?: string;
  averagePurchasePrice?: string;
}) {
  const [interval, setIntervalState] = useState<ChartInterval>("1d");
  const [loadedStoredInterval, setLoadedStoredInterval] = useState(false);
  const [marketAdvisorResult, setMarketAdvisorResult] =
    useState<MarketAdvisorResult | undefined>(undefined);

  const prices = usePrices([symbol]);
  const limits = usePriceLimits(symbol);
  const orderbook = useOrderbook(symbol);
  const candles = useCandles(
    loadedStoredInterval ? symbol : undefined,
    sourceInterval(interval),
  );
  // Daily candles power the header's day change (vs previous close), regardless
  // of the chart's selected interval.
  const dailyCandles = useCandles(symbol, "1d");

  const quote = prices.data?.[0];
  const currency = quote?.currency ?? "KRW";
  const change = priceChange(
    quote?.lastPrice,
    previousClose(dailyCandles.data?.candles ?? []),
  );
  const sourceCandles = candles.data?.candles;
  const chartCandles = useMemo(
    () => aggregateCandles(sourceCandles ?? [], interval),
    [sourceCandles, interval],
  );
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
    }),
    [chartCandles, currency, interval, name, quote?.lastPrice, symbol],
  );

  function setInterval(interval: ChartInterval) {
    setIntervalState(interval);
    writeStoredInterval(interval);
  }

  const handleMarketAdvisorResult = useCallback(
    (result: MarketAdvisorResult | undefined) => {
      setMarketAdvisorResult(result);
    },
    [],
  );

  useEffect(() => {
    setIntervalState(readStoredInterval());
    setLoadedStoredInterval(true);
  }, []);

  useEffect(() => {
    document.title = `${titlePrice} ${titleRate} ${titleName}`;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [titleName, titlePrice, titleRate]);

  return (
    <CollapsibleCard title="시세" storageId="market-quote">
      <div className={styles.quoteRow}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>
            {name ? `${name} (${symbol})` : `현재가 (${symbol})`}
          </span>
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

        <div className={styles.metric}>
          <span className={styles.metricLabel}>상한가</span>
          <span className={styles.metricSecondary}>
            {limits.isLoading ? (
              "불러오는 중…"
            ) : (
              <Money
                value={formatPrice(limits.data?.upperLimitPrice ?? null, currency)}
              />
            )}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>하한가</span>
          <span className={styles.metricSecondary}>
            {limits.isLoading ? (
              "불러오는 중…"
            ) : (
              <Money
                value={formatPrice(limits.data?.lowerLimitPrice ?? null, currency)}
              />
            )}
          </span>
        </div>
      </div>

      <div className={`${page.controls} ${styles.chartControls}`}>
        <span className={page.controlLabel}>차트</span>
        {CHART_INTERVALS.map((item) => (
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

      {candles.isLoading ? (
        <p className={page.status}>차트를 불러오는 중…</p>
      ) : candles.error ? (
        <p className={`${page.status} ${page.error}`} role="alert">
          차트를 불러오지 못했습니다: {candles.error.message}
        </p>
      ) : candles.data ? (
        <>
          <CandleChart
            candles={chartCandles}
            averagePurchasePrice={averagePurchasePrice}
            annotations={marketAdvisorResult?.annotations}
          />
          <MarketAiAdvisor
            input={marketAdvisorInput}
            onResult={handleMarketAdvisorResult}
          />
        </>
      ) : null}

      {orderbook.isLoading ? (
        <p className={page.status}>호가를 불러오는 중…</p>
      ) : orderbook.error ? (
        <p className={`${page.status} ${page.error}`} role="alert">
          호가를 불러오지 못했습니다: {orderbook.error.message}
        </p>
      ) : orderbook.data ? (
        <Orderbook book={orderbook.data} />
      ) : null}
    </CollapsibleCard>
  );
}
