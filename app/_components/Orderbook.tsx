import type { OrderbookResponse } from "@/lib/client/types";
import { formatDecimal, formatKrw, formatUsd } from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import styles from "./dashboard.module.css";

/** Formats an orderbook price in the book's own trading currency. */
function formatPrice(value: string, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/**
 * Bid/ask orderbook table. Asks (sell orders) are shown highest-price-first so
 * the best ask sits next to the bids, and bids (buy orders) highest-first.
 * Renders an empty state when both sides are empty.
 */
export function Orderbook({ book }: { book: OrderbookResponse }) {
  const { asks, bids, currency } = book;

  if (asks.length === 0 && bids.length === 0) {
    return (
      <CollapsibleCard title="호가" storageId="orderbook">
        <p className={styles.empty}>호가 정보 없음</p>
      </CollapsibleCard>
    );
  }

  // Asks arrive low-to-high; display high-to-low so the best ask is adjacent to
  // the spread. Bids already arrive high-to-low.
  const displayAsks = [...asks].reverse();

  return (
    <CollapsibleCard title="호가" storageId="orderbook">
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">구분</th>
              <th scope="col">가격</th>
              <th scope="col">잔량</th>
            </tr>
          </thead>
          <tbody>
            {displayAsks.map((ask, index) => (
              <tr key={`ask-${index}`}>
                <td>
                  <span className={`${styles.marketBadge} ${styles.negative}`}>
                    매도
                  </span>
                </td>
                <td className={styles.negative}>
                  <Money value={formatPrice(ask.price, currency)} />
                </td>
                <td>{formatDecimal(ask.volume, { maxFractionDigits: 4 })}</td>
              </tr>
            ))}
            {bids.map((bid, index) => (
              <tr key={`bid-${index}`}>
                <td>
                  <span className={`${styles.marketBadge} ${styles.positive}`}>
                    매수
                  </span>
                </td>
                <td className={styles.positive}>
                  <Money value={formatPrice(bid.price, currency)} />
                </td>
                <td>{formatDecimal(bid.volume, { maxFractionDigits: 4 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}
