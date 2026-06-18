import type { HoldingsOverview } from "@/lib/client/types";
import { formatKrw, formatPercent, formatUsd, signOf } from "@/lib/client/format";
import styles from "./dashboard.module.css";

/** Maps a decimal sign to the matching color class. */
function signClass(value: string | null | undefined): string {
  return styles[signOf(value)];
}

/**
 * Portfolio headline metrics: total market value (KRW with USD breakdown),
 * total profit/loss (amount + rate), and the daily profit/loss. Gains and
 * losses are colored by sign.
 */
export function PortfolioSummary({
  overview,
}: {
  overview: HoldingsOverview;
}) {
  const { marketValue, profitLoss, dailyProfitLoss } = overview;

  return (
    <section className={styles.card} aria-label="포트폴리오 요약">
      <h2 className={styles.cardTitle}>포트폴리오 요약</h2>
      <div className={styles.summaryGrid}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>총 평가금액</span>
          <span className={styles.metricPrimary}>
            {formatKrw(marketValue.amount.krw)}
          </span>
          <span className={styles.metricSecondary}>
            {formatUsd(marketValue.amount.usd)}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>총 손익</span>
          <span className={`${styles.metricPrimary} ${signClass(profitLoss.amount.krw)}`}>
            {formatKrw(profitLoss.amount.krw)}
          </span>
          <span className={`${styles.metricChange} ${signClass(profitLoss.rate)}`}>
            {formatPercent(profitLoss.rate)}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>일간 손익</span>
          <span
            className={`${styles.metricPrimary} ${signClass(dailyProfitLoss.amount.krw)}`}
          >
            {formatKrw(dailyProfitLoss.amount.krw)}
          </span>
          <span className={`${styles.metricChange} ${signClass(dailyProfitLoss.rate)}`}>
            {formatPercent(dailyProfitLoss.rate)}
          </span>
        </div>
      </div>
    </section>
  );
}
