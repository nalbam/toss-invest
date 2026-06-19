"use client";

import { useState } from "react";
import {
  useCandles,
  useOrderbook,
  usePriceLimits,
  usePrices,
} from "@/lib/client/hooks";
import { formatKrw, formatPercent, formatUsd, signOf } from "@/lib/client/format";
import { previousClose, priceChange } from "@/lib/client/quote";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import { CandleChart } from "./CandleChart";
import { Orderbook } from "./Orderbook";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

/** Formats a price in the given trading currency. */
function formatPrice(value: string | null, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/** Maps a decimal sign to the matching color class. */
function signClass(value: string | null | undefined): string {
  return styles[signOf(value)];
}

/**
 * Market quote section for the selected symbol: its name/last price header, a
 * candlestick chart (1m/1d toggle), the orderbook, and the daily price limits.
 * The symbol is controlled by the parent (driven by the holdings selection),
 * not an in-component input. `name` is shown in the header when known.
 */
export function MarketQuote({
  symbol,
  name,
}: {
  symbol: string;
  name?: string;
}) {
  const [interval, setInterval] = useState<"1m" | "1d">("1d");

  const prices = usePrices([symbol]);
  const limits = usePriceLimits(symbol);
  const orderbook = useOrderbook(symbol);
  const candles = useCandles(symbol, interval);
  // Daily candles power the header's day change (vs previous close), regardless
  // of the chart's selected interval.
  const dailyCandles = useCandles(symbol, "1d");

  const quote = prices.data?.[0];
  const currency = quote?.currency ?? "KRW";
  const change = priceChange(
    quote?.lastPrice,
    previousClose(dailyCandles.data?.candles ?? []),
  );

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

      <div className={page.controls}>
        <span className={page.controlLabel}>차트</span>
        <button
          type="button"
          className={page.select}
          aria-pressed={interval === "1m"}
          onClick={() => setInterval("1m")}
        >
          1분
        </button>
        <button
          type="button"
          className={page.select}
          aria-pressed={interval === "1d"}
          onClick={() => setInterval("1d")}
        >
          1일
        </button>
      </div>

      {candles.isLoading ? (
        <p className={page.status}>차트를 불러오는 중…</p>
      ) : candles.error ? (
        <p className={`${page.status} ${page.error}`} role="alert">
          차트를 불러오지 못했습니다: {candles.error.message}
        </p>
      ) : candles.data ? (
        <CandleChart candles={candles.data.candles} />
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
