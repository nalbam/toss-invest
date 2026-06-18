import type { HoldingsItem } from "@/lib/client/types";
import {
  formatDecimal,
  formatKrw,
  formatPercent,
  formatUsd,
  signOf,
} from "@/lib/client/format";
import styles from "./dashboard.module.css";

/** Formats a per-share price in the item's own trading currency. */
function formatPrice(value: string, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

function signClass(value: string | null | undefined): string {
  return styles[signOf(value)];
}

/**
 * Tabular view of holdings. Each row shows the instrument, market, quantity,
 * average/last price (in the item's currency), market value, total P/L
 * (amount + rate), and daily P/L. Renders an empty state when there are no
 * holdings.
 */
export function HoldingsTable({ items }: { items: HoldingsItem[] }) {
  if (items.length === 0) {
    return (
      <section className={styles.card} aria-label="보유 종목">
        <h2 className={styles.cardTitle}>보유 종목</h2>
        <p className={styles.empty}>보유 종목 없음</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="보유 종목">
      <h2 className={styles.cardTitle}>보유 종목</h2>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">종목</th>
              <th scope="col">시장</th>
              <th scope="col">수량</th>
              <th scope="col">평균가</th>
              <th scope="col">현재가</th>
              <th scope="col">평가금액</th>
              <th scope="col">손익</th>
              <th scope="col">일간손익</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.symbol}>
                <td>
                  <span className={styles.symbolCell}>
                    <span className={styles.symbolName}>{item.name}</span>
                    <span className={styles.symbolTicker}>{item.symbol}</span>
                  </span>
                </td>
                <td>
                  <span className={styles.marketBadge}>{item.marketCountry}</span>
                </td>
                <td>{formatDecimal(item.quantity, { maxFractionDigits: 4 })}</td>
                <td>{formatPrice(item.averagePurchasePrice, item.currency)}</td>
                <td>{formatPrice(item.lastPrice, item.currency)}</td>
                <td>{formatKrw(item.marketValue.amount)}</td>
                <td>
                  <span className={styles.stacked}>
                    <span className={signClass(item.profitLoss.amount)}>
                      {formatKrw(item.profitLoss.amount)}
                    </span>
                    <span className={signClass(item.profitLoss.rate)}>
                      {formatPercent(item.profitLoss.rate)}
                    </span>
                  </span>
                </td>
                <td>
                  <span className={styles.stacked}>
                    <span className={signClass(item.dailyProfitLoss.amount)}>
                      {formatKrw(item.dailyProfitLoss.amount)}
                    </span>
                    <span className={signClass(item.dailyProfitLoss.rate)}>
                      {formatPercent(item.dailyProfitLoss.rate)}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
