import type { ExchangeRateResponse } from "@/lib/client/types";
import { formatDecimal } from "@/lib/client/format";
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

/** Shows the current exchange rate and its movement direction. */
export function FxRate({ rate }: { rate: ExchangeRateResponse }) {
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
    </section>
  );
}
