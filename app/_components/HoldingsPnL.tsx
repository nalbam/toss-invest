import type { HoldingsItem } from "@/lib/client/types";
import { formatPercent, signOf } from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

export interface PnlBar {
  symbol: string;
  name: string;
  rate: number;
  rateText: string;
  amount: string;
  currency: string;
}

/**
 * Per-holding profit-loss as a diverging bar dataset keyed off the return rate
 * (`profitLoss.rate`), which is currency-agnostic so KR and US positions are
 * comparable without conversion. Items with an unparseable rate are dropped and
 * the rest are sorted by rate, gains first. Pure for unit testing.
 */
export function toPnlBars(items: HoldingsItem[]): PnlBar[] {
  return items
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      rate: Number(item.profitLoss.rate),
      rateText: item.profitLoss.rate,
      amount: item.profitLoss.amount,
      currency: item.currency,
    }))
    .filter((bar) => Number.isFinite(bar.rate))
    .sort((a, b) => b.rate - a.rate);
}

/**
 * Diverging horizontal bar chart of each holding's return rate: gains extend
 * right (red) from a center baseline, losses left (blue), each bar scaled to
 * the largest absolute rate. CSS bars, no extra dependency.
 */
export function HoldingsPnL({
  items,
  refreshing,
}: {
  items: HoldingsItem[];
  refreshing?: boolean;
}) {
  const bars = toPnlBars(items);

  if (bars.length === 0) {
    return (
      <CollapsibleCard title="종목별 손익" storageId="holdings-pnl" refreshing={refreshing}>
        <p className={styles.empty}>보유 종목 없음</p>
      </CollapsibleCard>
    );
  }

  const maxAbs = Math.max(...bars.map((bar) => Math.abs(bar.rate)), 0);

  return (
    <CollapsibleCard title="종목별 손익" storageId="holdings-pnl" refreshing={refreshing}>
      <ul className={styles.pnlList}>
        {bars.map((bar) => {
          const ratio = maxAbs === 0 ? 0 : (Math.abs(bar.rate) / maxAbs) * 100;
          const sign = signOf(bar.rateText);
          const isGain = bar.rate > 0;
          return (
            <li key={bar.symbol} className={styles.pnlRow}>
              <span className={styles.pnlName}>{bar.name}</span>
              <div className={styles.pnlTrack}>
                <div className={`${styles.pnlHalf} ${styles.pnlHalfLeft}`}>
                  {!isGain && bar.rate < 0 ? (
                    <span
                      className={`${styles.pnlBar} ${styles.negative}`}
                      style={{ width: `${ratio}%`, background: "var(--loss)" }}
                    />
                  ) : null}
                </div>
                <div className={styles.pnlHalf}>
                  {isGain ? (
                    <span
                      className={`${styles.pnlBar} ${styles.positive}`}
                      style={{ width: `${ratio}%`, background: "var(--gain)" }}
                    />
                  ) : null}
                </div>
              </div>
              <span className={`${styles.pnlValue} ${styles[sign]}`}>
                {formatPercent(bar.rateText)}
              </span>
            </li>
          );
        })}
      </ul>
    </CollapsibleCard>
  );
}
