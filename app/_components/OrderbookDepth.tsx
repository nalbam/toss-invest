import type { OrderbookResponse } from "@/lib/client/types";
import { formatDecimal } from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

export interface DepthPoint {
  price: number;
  cumulative: number;
}

export interface Depth {
  bids: DepthPoint[];
  asks: DepthPoint[];
  maxCumulative: number;
}

/**
 * Cumulative market-depth ladder from an orderbook. Bids accumulate from the
 * highest price downward, asks from the lowest price upward, so each point's
 * `cumulative` is the total resting volume between the best price and that
 * level. Entries with an unparseable price or volume are dropped. Pure and
 * canvas-free so it is unit-testable; the SVG below renders the result.
 */
export function toDepth(book: OrderbookResponse): Depth {
  const parse = (entries: { price: string; volume: string }[]) =>
    entries
      .map((entry) => ({ price: Number(entry.price), volume: Number(entry.volume) }))
      .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.volume));

  const bidsRaw = parse(book.bids).sort((a, b) => b.price - a.price);
  const asksRaw = parse(book.asks).sort((a, b) => a.price - b.price);

  let bidCum = 0;
  const bids = bidsRaw.map((entry) => {
    bidCum += entry.volume;
    return { price: entry.price, cumulative: bidCum };
  });
  let askCum = 0;
  const asks = asksRaw.map((entry) => {
    askCum += entry.volume;
    return { price: entry.price, cumulative: askCum };
  });

  const maxCumulative = Math.max(
    bids.length ? bids[bids.length - 1].cumulative : 0,
    asks.length ? asks[asks.length - 1].cumulative : 0,
  );
  return { bids, asks, maxCumulative };
}

/** Builds a stepped area path (down to the baseline) for points sorted by x. */
function steppedAreaPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) {
    return "";
  }
  const round = (value: number) => Number(value.toFixed(2));
  let path = `M ${round(points[0].x)} 100 L ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${round(points[i].x)} ${round(points[i - 1].y)} L ${round(points[i].x)} ${round(points[i].y)}`;
  }
  path += ` L ${round(points[points.length - 1].x)} 100 Z`;
  return path;
}

/**
 * Cumulative depth chart for the selected symbol's orderbook, rendered as two
 * inline-SVG stepped areas (bids red on the left, asks blue on the right) over
 * a shared linear price axis. Complements the `Orderbook` table; lightweight-
 * charts is time-series oriented and unsuitable for a price x-axis, so this
 * uses hand-rolled SVG with no extra dependency.
 */
export function OrderbookDepth({
  book,
  refreshing,
}: {
  book: OrderbookResponse;
  refreshing?: boolean;
}) {
  const depth = toDepth(book);
  const all = [...depth.bids, ...depth.asks];

  if (all.length === 0) {
    return (
      <CollapsibleCard
        title="호가 뎁스"
        storageId="orderbook-depth"
        refreshing={refreshing}
      >
        <p className={styles.empty}>호가 정보 없음</p>
      </CollapsibleCard>
    );
  }

  const prices = all.map((point) => point.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const span = maxPrice - minPrice;
  const priceToX = (price: number) =>
    span === 0 ? 50 : ((price - minPrice) / span) * 100;
  const cumToY = (cumulative: number) =>
    depth.maxCumulative === 0 ? 100 : 100 - (cumulative / depth.maxCumulative) * 100;

  // Bids accumulate high→low price; render left→right (ascending price).
  const bidPath = steppedAreaPath(
    [...depth.bids]
      .reverse()
      .map((point) => ({ x: priceToX(point.price), y: cumToY(point.cumulative) })),
  );
  const askPath = steppedAreaPath(
    depth.asks.map((point) => ({
      x: priceToX(point.price),
      y: cumToY(point.cumulative),
    })),
  );

  const totalBid = depth.bids.length
    ? depth.bids[depth.bids.length - 1].cumulative
    : 0;
  const totalAsk = depth.asks.length
    ? depth.asks[depth.asks.length - 1].cumulative
    : 0;

  return (
    <CollapsibleCard
      title="호가 뎁스"
      storageId="orderbook-depth"
      refreshing={refreshing}
    >
      <svg
        className={styles.depthSvg}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="호가 뎁스 차트"
      >
        {bidPath ? (
          <path
            d={bidPath}
            fill="var(--gain)"
            fillOpacity={0.18}
            stroke="var(--gain)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {askPath ? (
          <path
            d={askPath}
            fill="var(--loss)"
            fillOpacity={0.18}
            stroke="var(--loss)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <div className={styles.depthLegend}>
        <span className={styles.positive}>
          매수 누적 {formatDecimal(String(totalBid), { maxFractionDigits: 4 })}
        </span>
        <span className={styles.negative}>
          매도 누적 {formatDecimal(String(totalAsk), { maxFractionDigits: 4 })}
        </span>
      </div>
    </CollapsibleCard>
  );
}
