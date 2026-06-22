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
 * When `onSelectSymbol` is provided each row becomes selectable: clicking the
 * row or pressing Enter/Space on it selects that symbol so the surrounding
 * dashboard can drive the market panel and order form. The row for
 * `selectedSymbol` is highlighted.
 */
export function HoldingsTable({
  items,
  selectedSymbol,
  onSelectSymbol,
  refreshing,
}: {
  items: HoldingsItem[];
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
  refreshing?: boolean;
}) {
  const summary = (
    <span className={styles.holdingsSummaryList}>
      {items.length === 0 ? (
        <span className={styles.holdingsSummaryItem}>
          <span className={styles.metricLabel}>보유 종목 없음</span>
          <span className={styles.holdingValue}>-</span>
        </span>
      ) : (
        items.map((item) => (
          <span key={item.symbol} className={styles.holdingsSummaryItem}>
            <span className={styles.holdingsSummaryName}>{item.name}</span>
            <span className={styles.holdingValue}>
              <Money value={formatPrice(item.marketValue.amount, item.currency)} />
            </span>
          </span>
        ))
      )}
    </span>
  );

  if (items.length === 0) {
    return (
      <CollapsibleCard
        title="보유 종목"
        storageId="holdings"
        refreshing={refreshing}
        summary={summary}
      >
        <p className={styles.empty}>보유 종목 없음</p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard
      title="보유 종목"
      storageId="holdings"
      refreshing={refreshing}
      summary={summary}
    >
      <div className={styles.holdingsList}>
        {items.map((item) => {
          const selected = selectedSymbol === item.symbol;
          const itemClass = `${styles.holdingItem} ${
            onSelectSymbol ? styles.selectableHoldingItem : ""
          } ${selected ? styles.selectedHoldingItem : ""}`;
          const content = (
            <>
              <span className={styles.holdingMain}>
                <span className={styles.symbolCell}>
                  <span className={styles.symbolName}>{item.name}</span>
                  <span className={styles.symbolTicker}>
                    {item.symbol} · {item.marketCountry} ·{" "}
                    {formatDecimal(item.quantity, { maxFractionDigits: 4 })}주
                  </span>
                </span>
                <span className={styles.holdingValue}>
                  <Money value={formatPrice(item.marketValue.amount, item.currency)} />
                </span>
              </span>
              <span className={styles.holdingDetails}>
                <span>
                  <span className={styles.holdingLabel}>현재가</span>
                  <span className={styles.holdingAmount}>
                    <Money value={formatPrice(item.lastPrice, item.currency)} />
                  </span>
                </span>
                <span>
                  <span className={styles.holdingLabel}>평균단가</span>
                  <span className={styles.holdingAmount}>
                    <Money value={formatPrice(item.averagePurchasePrice, item.currency)} />
                  </span>
                </span>
                <span>
                  <span className={styles.holdingLabel}>매입금액</span>
                  <span className={styles.holdingAmount}>
                    <Money value={formatPrice(item.marketValue.purchaseAmount, item.currency)} />
                  </span>
                </span>
              </span>
              <span className={styles.holdingProfit}>
                <span className={styles.holdingLabel}>손익</span>
                <span className={signClass(item.profitLoss.amount)}>
                  <Money value={formatPrice(item.profitLoss.amount, item.currency)} />{" "}
                  ({formatPercent(item.profitLoss.rate)})
                </span>
              </span>
            </>
          );

          if (onSelectSymbol) {
            return (
              <button
                key={item.symbol}
                type="button"
                className={itemClass}
                aria-pressed={selected}
                onClick={() => onSelectSymbol(item.symbol)}
              >
                {content}
              </button>
            );
          }

          return (
            <div key={item.symbol} className={itemClass}>
              {content}
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}
