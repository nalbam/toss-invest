"use client";

import { useState } from "react";
import {
  useCandles,
  useOrderbook,
  usePriceLimits,
  usePrices,
} from "@/lib/client/hooks";
import { formatKrw, formatUsd } from "@/lib/client/format";
import { CandleChart } from "./CandleChart";
import { Orderbook } from "./Orderbook";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

const DEFAULT_SYMBOL = "005930";

/** Formats a price in the given trading currency. */
function formatPrice(value: string | null, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/**
 * Market quote section: pick a symbol, then view its last price, daily price
 * limits, orderbook, and a candlestick chart (1m/1d toggle). Defaults to the
 * first holding's symbol when available, otherwise `005930`.
 */
export function MarketQuote({ defaultSymbol }: { defaultSymbol?: string }) {
  const initial = defaultSymbol ?? DEFAULT_SYMBOL;
  const [symbol, setSymbol] = useState(initial);
  const [input, setInput] = useState(initial);
  const [interval, setInterval] = useState<"1m" | "1d">("1d");

  const prices = usePrices([symbol]);
  const limits = usePriceLimits(symbol);
  const orderbook = useOrderbook(symbol);
  const candles = useCandles(symbol, interval);

  const quote = prices.data?.[0];
  const currency = quote?.currency ?? "KRW";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (next.length > 0) {
      setSymbol(next);
    }
  }

  return (
    <section className={styles.card} aria-label="시세">
      <h2 className={styles.cardTitle}>시세</h2>

      <form className={page.controls} onSubmit={handleSubmit}>
        <label htmlFor="symbol-input" className={page.controlLabel}>
          종목코드
        </label>
        <input
          id="symbol-input"
          className={page.select}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="예: 005930"
        />
        <button type="submit" className={page.select}>
          조회
        </button>
      </form>

      <div className={styles.quoteRow}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>현재가 ({symbol})</span>
          {prices.isLoading ? (
            <span className={styles.metricSecondary}>불러오는 중…</span>
          ) : prices.error ? (
            <span className={`${styles.metricSecondary} ${styles.negative}`}>
              {prices.error.message}
            </span>
          ) : quote ? (
            <span className={styles.metricPrimary}>
              {formatPrice(quote.lastPrice, currency)}
            </span>
          ) : (
            <span className={styles.metricSecondary}>-</span>
          )}
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>상한가</span>
          <span className={styles.metricSecondary}>
            {limits.isLoading
              ? "불러오는 중…"
              : formatPrice(limits.data?.upperLimitPrice ?? null, currency)}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>하한가</span>
          <span className={styles.metricSecondary}>
            {limits.isLoading
              ? "불러오는 중…"
              : formatPrice(limits.data?.lowerLimitPrice ?? null, currency)}
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
    </section>
  );
}
