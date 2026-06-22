import type { HoldingsItem } from "@/lib/client/types";
import { mulDecimalStrings } from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

export interface CompositionSegment {
  symbol: string;
  name: string;
  valueKrw: number;
  percent: number;
}

// Distinct, theme-agnostic palette cycled by segment order.
const PALETTE = [
  "#3b82f6",
  "#ff4d6d",
  "#f5a623",
  "#22c55e",
  "#a855f7",
  "#06b6d4",
  "#eab308",
  "#ec4899",
];

/**
 * Portfolio composition by market value, normalized to KRW so KR and US
 * holdings are comparable. US positions are converted with `fxRate` (USD→KRW);
 * without a rate they fall back to their raw amount so the chart still renders.
 * Items with a non-positive or unparseable value are dropped, and segments are
 * sorted largest-first. Pure and canvas-free for unit testing.
 */
export function toComposition(
  items: HoldingsItem[],
  fxRate?: string,
): CompositionSegment[] {
  const valued = items
    .map((item) => {
      const raw = item.marketValue.amount;
      const krwString =
        item.currency === "USD" && fxRate
          ? mulDecimalStrings(raw, fxRate)
          : raw;
      return {
        symbol: item.symbol,
        name: item.name,
        valueKrw: Number(krwString),
      };
    })
    .filter((item) => Number.isFinite(item.valueKrw) && item.valueKrw > 0);

  const total = valued.reduce((sum, item) => sum + item.valueKrw, 0);
  if (total === 0) {
    return [];
  }
  return valued
    .map((item) => ({ ...item, percent: (item.valueKrw / total) * 100 }))
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

/**
 * Donut chart of portfolio composition by market value, rendered with stacked
 * SVG circle arcs (stroke-dasharray) plus a legend. Hand-rolled SVG keeps the
 * no-extra-dependency convention.
 */
export function PortfolioComposition({
  items,
  fxRate,
  refreshing,
}: {
  items: HoldingsItem[];
  fxRate?: string;
  refreshing?: boolean;
}) {
  const segments = toComposition(items, fxRate);

  if (segments.length === 0) {
    return (
      <CollapsibleCard
        title="포트폴리오 구성"
        storageId="portfolio-composition"
        refreshing={refreshing}
      >
        <p className={styles.empty}>보유 종목 없음</p>
      </CollapsibleCard>
    );
  }

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <CollapsibleCard
      title="포트폴리오 구성"
      storageId="portfolio-composition"
      refreshing={refreshing}
    >
      <div className={styles.compositionLayout}>
        <svg
          className={styles.donut}
          viewBox="0 0 100 100"
          role="img"
          aria-label="포트폴리오 구성 도넛"
        >
          {segments.map((segment, index) => {
            const length = (segment.percent / 100) * circumference;
            const circle = (
              <circle
                key={segment.symbol}
                cx={50}
                cy={50}
                r={radius}
                fill="none"
                stroke={PALETTE[index % PALETTE.length]}
                strokeWidth={16}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
              />
            );
            offset += length;
            return circle;
          })}
        </svg>
        <ul className={styles.legend}>
          {segments.map((segment, index) => (
            <li key={segment.symbol} className={styles.legendItem}>
              <span
                className={styles.swatch}
                style={{ background: PALETTE[index % PALETTE.length] }}
                aria-hidden
              />
              <span className={styles.legendName}>{segment.name}</span>
              <span className={styles.legendPercent}>
                {segment.percent.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </CollapsibleCard>
  );
}
