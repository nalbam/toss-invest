import type { HoldingsItem } from "@/lib/client/types";
import {
  formatDecimal,
  formatKrw,
  formatPercent,
  formatUsd,
  signOf,
} from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
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
 *
 * When `onSelectSymbol` is provided each row's symbol cell becomes a button:
 * clicking it (or activating it via the keyboard) selects that symbol so the
 * surrounding dashboard can drive the market panel and order form. The row for
 * `selectedSymbol` is highlighted.
 */
export function HoldingsTable({
  items,
  selectedSymbol,
  onSelectSymbol,
}: {
  items: HoldingsItem[];
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
}) {
  if (items.length === 0) {
    return (
      <CollapsibleCard title="보유 종목" storageId="holdings">
        <p className={styles.empty}>보유 종목 없음</p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard title="보유 종목" storageId="holdings">
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
            {items.map((item) => {
              const selected = selectedSymbol === item.symbol;
              const rowClass = onSelectSymbol
                ? `${styles.selectableRow} ${selected ? styles.selectedRow : ""}`
                : undefined;
              return (
              <tr
                key={item.symbol}
                className={rowClass}
                aria-selected={onSelectSymbol ? selected : undefined}
              >
                <td>
                  {onSelectSymbol ? (
                    <button
                      type="button"
                      className={styles.symbolButton}
                      onClick={() => onSelectSymbol(item.symbol)}
                    >
                      <span className={styles.symbolName}>{item.name}</span>
                      <span className={styles.symbolTicker}>{item.symbol}</span>
                    </button>
                  ) : (
                    <span className={styles.symbolCell}>
                      <span className={styles.symbolName}>{item.name}</span>
                      <span className={styles.symbolTicker}>{item.symbol}</span>
                    </span>
                  )}
                </td>
                <td>
                  <span className={styles.marketBadge}>{item.marketCountry}</span>
                </td>
                <td>{formatDecimal(item.quantity, { maxFractionDigits: 4 })}</td>
                <td>
                  <Money value={formatPrice(item.averagePurchasePrice, item.currency)} />
                </td>
                <td>
                  <Money value={formatPrice(item.lastPrice, item.currency)} />
                </td>
                <td>
                  <Money value={formatPrice(item.marketValue.amount, item.currency)} />
                </td>
                <td>
                  <span className={styles.stacked}>
                    <span className={signClass(item.profitLoss.amount)}>
                      <Money value={formatPrice(item.profitLoss.amount, item.currency)} />
                    </span>
                    <span className={signClass(item.profitLoss.rate)}>
                      {formatPercent(item.profitLoss.rate)}
                    </span>
                  </span>
                </td>
                <td>
                  <span className={styles.stacked}>
                    <span className={signClass(item.dailyProfitLoss.amount)}>
                      <Money value={formatPrice(item.dailyProfitLoss.amount, item.currency)} />
                    </span>
                    <span className={signClass(item.dailyProfitLoss.rate)}>
                      {formatPercent(item.dailyProfitLoss.rate)}
                    </span>
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}
