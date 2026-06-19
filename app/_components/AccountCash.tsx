import type { ExchangeRateResponse } from "@/lib/client/types";
import {
  addDecimalStrings,
  formatDecimal,
  formatKrw,
  formatUsd,
  mulDecimalStrings,
} from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
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
 * Account cash / order capacity card (mirrors Toss's "주문 가능 금액"): the KRW
 * and USD cash balances, the USD balance also converted to KRW, and a single
 * KRW-converted total. The exchange rate is shown as a caption because its role
 * here is to value the USD balance — not a metric in its own right. `cash` may
 * be absent while balances load (shown as "-").
 */
export function AccountCash({
  rate,
  cash,
}: {
  rate: ExchangeRateResponse;
  cash?: { krw?: string; usd?: string };
}) {
  const indicator = changeIndicator(rate.rateChangeType);
  const usdInKrw = mulDecimalStrings(cash?.usd ?? "0", rate.rate);
  const hasCash =
    cash !== undefined && (cash.krw !== undefined || cash.usd !== undefined);
  const totalKrw = hasCash
    ? addDecimalStrings(cash?.krw ?? "0", usdInKrw)
    : null;

  return (
    <CollapsibleCard
      title="주문 가능 금액"
      storageId="account-cash"
      summary={
        <>
          <span className={styles.metricLabel}>총 주문가능</span>
          <span className={styles.metricPrimary}>
            <Money value={formatKrw(totalKrw)} />
          </span>
        </>
      }
    >
      <div className={styles.summaryGrid}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>총 주문가능 (원화 환산)</span>
          <span className={styles.metricPrimary}>
            <Money value={formatKrw(totalKrw)} />
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>원화</span>
          <span className={styles.metricPrimary}>
            <Money value={formatKrw(cash?.krw)} />
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>달러</span>
          <span className={styles.metricPrimary}>
            <Money value={formatUsd(cash?.usd)} />
          </span>
          <span className={styles.metricSecondary}>
            ≈ <Money value={formatKrw(cash?.usd === undefined ? undefined : usdInKrw)} />
          </span>
        </div>
      </div>
      <div className={styles.fxRow}>
        <span className={styles.metricLabel}>환율</span>
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
    </CollapsibleCard>
  );
}
