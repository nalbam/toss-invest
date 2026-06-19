import type { HoldingsOverview } from "@/lib/client/types";
import {
  addDecimalStrings,
  formatKrw,
  formatPercent,
  formatUsd,
  mulDecimalStrings,
  signOf,
} from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import styles from "./dashboard.module.css";

/** Maps a decimal sign to the matching color class. */
function signClass(value: string | null | undefined): string {
  return styles[signOf(value)];
}

/**
 * Portfolio headline metrics: total assets in KRW (holdings + cash, with USD
 * converted via the exchange rate — mirrors Toss's account total), then the
 * market value (KRW with USD breakdown) and total/daily profit-loss. Gains and
 * losses are colored by sign. `fxRate` (USD->KRW) values USD assets; without it
 * the total degrades to the KRW portions so nothing breaks while it loads.
 */
export function PortfolioSummary({
  overview,
  cash,
  fxRate,
  refreshing,
}: {
  overview: HoldingsOverview;
  cash?: { krw?: string; usd?: string };
  fxRate?: string;
  refreshing?: boolean;
}) {
  const { marketValue, profitLoss, dailyProfitLoss } = overview;

  // USD -> KRW (0 when no rate yet, so the total degrades to KRW parts only).
  const usdToKrw = (usd: string | null | undefined): string =>
    fxRate ? mulDecimalStrings(usd ?? "0", fxRate) : "0";
  const totalAssetsKrw = [
    marketValue.amount.krw,
    usdToKrw(marketValue.amount.usd),
    cash?.krw ?? "0",
    usdToKrw(cash?.usd),
  ].reduce((acc, value) => addDecimalStrings(acc, value), "0");

  return (
    <CollapsibleCard
      title="포트폴리오 요약"
      storageId="portfolio-summary"
      refreshing={refreshing}
      summary={
        <>
          <span className={styles.metricLabel}>총 자산</span>
          <span className={styles.metricPrimary}>
            <Money value={formatKrw(totalAssetsKrw)} />
          </span>
        </>
      }
    >
      <div className={styles.summaryGrid}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>총 자산 (원화 환산)</span>
          <span className={styles.metricPrimary}>
            <Money value={formatKrw(totalAssetsKrw)} />
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>총 평가금액</span>
          <span className={styles.metricPrimary}>
            <Money value={formatKrw(marketValue.amount.krw)} />
          </span>
          <span className={styles.metricSecondary}>
            <Money value={formatUsd(marketValue.amount.usd)} />
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.metricLabel}>총 손익</span>
          <span className={`${styles.metricPrimary} ${signClass(profitLoss.amount.krw)}`}>
            <Money value={formatKrw(profitLoss.amount.krw)} />
          </span>
          <span className={`${styles.metricSecondary} ${signClass(profitLoss.amount.usd)}`}>
            <Money value={formatUsd(profitLoss.amount.usd)} />
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
            <Money value={formatKrw(dailyProfitLoss.amount.krw)} />
          </span>
          <span
            className={`${styles.metricSecondary} ${signClass(dailyProfitLoss.amount.usd)}`}
          >
            <Money value={formatUsd(dailyProfitLoss.amount.usd)} />
          </span>
          <span className={`${styles.metricChange} ${signClass(dailyProfitLoss.rate)}`}>
            {formatPercent(dailyProfitLoss.rate)}
          </span>
        </div>
      </div>
    </CollapsibleCard>
  );
}
