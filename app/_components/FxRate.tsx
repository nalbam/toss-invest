import type { ExchangeRateResponse } from "@/lib/client/types";
import { formatDecimal, formatKrw, formatUsd } from "@/lib/client/format";
import { Money } from "./Money";
import styles from "./dashboard.module.css";

/** Direction glyph + color class for the rate-change indicator. */
function changeIndicator(type: string): { label: string; className: string } {
  switch (type) {
    case "UP":
      return { label: "▲ 상승", className: styles.positive };
    case "DOWN":
      return { label: "▼ 하락", className: styles.negative };
    default:
      return { label: "― 보합", className: styles.zero };
  }
}

/**
 * Shows the current exchange rate and its movement direction. When `cash` is
 * provided, the account's KRW/USD cash balances are shown below the rate, each
 * currency rendered as-is (no FX conversion). A missing side shows "-".
 */
export function FxRate({
  rate,
  cash,
}: {
  rate: ExchangeRateResponse;
  cash?: { krw?: string; usd?: string };
}) {
  const indicator = changeIndicator(rate.rateChangeType);

  return (
    <section className={styles.card} aria-label="환율">
      <h2 className={styles.cardTitle}>환율</h2>
      <div className={styles.fxRow}>
        <span className={styles.fxRate}>
          {formatDecimal(rate.rate, { maxFractionDigits: 2 })}
        </span>
        <span className={styles.fxPair}>
          {rate.baseCurrency}/{rate.quoteCurrency}
        </span>
        <span className={`${styles.fxChange} ${indicator.className}`}>
          {indicator.label}
        </span>
      </div>
      {cash ? (
        <div className={styles.summaryGrid}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>계좌 잔액 (원화)</span>
            <span className={styles.metricSecondary}>
              <Money value={formatKrw(cash.krw)} />
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>계좌 잔액 (달러)</span>
            <span className={styles.metricSecondary}>
              <Money value={formatUsd(cash.usd)} />
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
