import type { Order } from "@/lib/client/types";
import { formatDecimal, formatKrw, formatUsd } from "@/lib/client/format";
import styles from "./dashboard.module.css";

/** Formats an order price in the order's own trading currency. */
function formatPrice(value: string | null, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/**
 * Renders an ISO date-time as "YYYY-MM-DD HH:mm" when parseable, otherwise the
 * raw string. Keeps display deterministic without depending on locale/timezone
 * formatting that would differ between server and client.
 */
function formatOrderedAt(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

/**
 * Tabular view of orders. Each row shows the instrument, side, order type,
 * status, ordered/filled quantity, price, and order time. Renders an empty
 * state when there are no orders.
 *
 * The upstream API does not yet support `CLOSED`, so this only ever lists
 * open (pending) orders — the title reflects that.
 */
export function OrdersTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <section className={styles.card} aria-label="주문 내역 (대기 중)">
        <h2 className={styles.cardTitle}>주문 내역 (대기 중)</h2>
        <p className={styles.empty}>주문 없음</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="주문 내역 (대기 중)">
      <h2 className={styles.cardTitle}>주문 내역 (대기 중)</h2>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">종목</th>
              <th scope="col">구분</th>
              <th scope="col">유형</th>
              <th scope="col">상태</th>
              <th scope="col">수량</th>
              <th scope="col">체결수량</th>
              <th scope="col">가격</th>
              <th scope="col">주문시각</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.orderId}>
                <td>
                  <span className={styles.symbolTicker}>{order.symbol}</span>
                </td>
                <td>{order.side}</td>
                <td>{order.orderType}</td>
                <td>
                  <span className={styles.marketBadge}>{order.status}</span>
                </td>
                <td>{formatDecimal(order.quantity, { maxFractionDigits: 4 })}</td>
                <td>
                  {formatDecimal(order.execution.filledQuantity, {
                    maxFractionDigits: 4,
                  })}
                </td>
                <td>{formatPrice(order.price, order.currency)}</td>
                <td>{formatOrderedAt(order.orderedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
