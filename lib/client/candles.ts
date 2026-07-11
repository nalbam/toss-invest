import type { Candle } from "@/lib/client/types";
import { addDecimalStrings } from "@/lib/client/format";

export type TossCandleInterval = "1m" | "1d";

export type ChartInterval =
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "30m"
  | "60m"
  | "120m"
  | "240m"
  | "1d"
  | "1w"
  | "1mo"
  | "1y";

/** Minute granularities, shown as a select box (분봉 단위). */
export const MINUTE_CHART_INTERVALS: ReadonlyArray<{
  value: ChartInterval;
  label: string;
}> = [
  { value: "1m", label: "1분" },
  { value: "3m", label: "3분" },
  { value: "5m", label: "5분" },
  { value: "10m", label: "10분" },
  { value: "30m", label: "30분" },
  { value: "60m", label: "60분" },
  { value: "120m", label: "120분" },
  { value: "240m", label: "240분" },
];

/** Day-and-longer intervals, shown as buttons beside the minute select. */
export const DAY_CHART_INTERVALS: ReadonlyArray<{
  value: ChartInterval;
  label: string;
}> = [
  { value: "1d", label: "일" },
  { value: "1w", label: "주" },
  { value: "1mo", label: "월" },
  { value: "1y", label: "년" },
];

/** Every selectable interval — canonical list for validation and label lookup. */
export const CHART_INTERVALS: ReadonlyArray<{
  value: ChartInterval;
  label: string;
}> = [...MINUTE_CHART_INTERVALS, ...DAY_CHART_INTERVALS];

/** Minute-bucket size per minute interval; all source from Toss 1m candles. */
const MINUTE_INTERVALS: Partial<Record<ChartInterval, number>> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "10m": 10,
  "30m": 30,
  "60m": 60,
  "120m": 120,
  "240m": 240,
};

/** Whether an interval is a minute granularity (vs day/week/month/year). */
export function isMinuteInterval(interval: ChartInterval): boolean {
  return interval in MINUTE_INTERVALS;
}

export function sourceInterval(interval: ChartInterval): TossCandleInterval {
  return interval in MINUTE_INTERVALS ? "1m" : "1d";
}

/** Toss source bars (1m for minutes, 1d for day+) that make up one bar of `interval`. */
const DAY_SOURCE_BARS: Partial<Record<ChartInterval, number>> = {
  "1d": 1,
  "1w": 7,
  "1mo": 31,
  "1y": 366,
};
export function sourceBarsPerChartBar(interval: ChartInterval): number {
  return MINUTE_INTERVALS[interval] ?? DAY_SOURCE_BARS[interval] ?? 1;
}

/** Aggregated bars the chart AI advisor analyzes (and the cap it slices to). */
export const ADVISOR_TARGET_BARS = 200;
// Cap source backfill so large minute intervals (30m+) and yearly charts don't
// trigger an oversized fetch — at most this many Toss pages (200 each). Sized so
// 1m–10m reach a full 200 bars and larger intervals get proportionally fewer
// (30m ≈ 160, 60m ≈ 80, 120m ≈ 40, 240m ≈ 20 bars).
const ADVISOR_MAX_SOURCE_CANDLES = 24 * 200;

/**
 * How many Toss source candles to collect so aggregation yields up to
 * `ADVISOR_TARGET_BARS` bars for `interval` — e.g. ~2000 one-minute candles for a
 * 10m chart, vs the single visible page. Bounded by `ADVISOR_MAX_SOURCE_CANDLES`,
 * so intervals above ~10m fill fewer than 200 bars.
 */
export function advisorSourceCandleCount(interval: ChartInterval): number {
  return Math.min(
    ADVISOR_TARGET_BARS * sourceBarsPerChartBar(interval),
    ADVISOR_MAX_SOURCE_CANDLES,
  );
}

/**
 * Aggregates collected source candles for `interval` and keeps the most recent
 * `ADVISOR_TARGET_BARS` bars — the candle window sent to the chart AI advisor.
 * Shared by the on-demand (client) and background-worker (server) advisor paths.
 */
export function aggregateForAdvisor(
  sourceCandles: Candle[],
  interval: ChartInterval,
): Candle[] {
  return aggregateCandles(combineCandlePages(sourceCandles), interval).slice(
    -ADVISOR_TARGET_BARS,
  );
}

/**
 * Combines candle lists (e.g. accumulated older pages plus the latest live page)
 * into one ascending series de-duplicated by timestamp. Later lists win on a
 * timestamp conflict, so passing `(older, latest)` keeps the freshest copy of
 * any overlapping candle. Use before `aggregateCandles` so the chart sees a
 * single clean source series.
 */
export function combineCandlePages(...lists: Candle[][]): Candle[] {
  const byTimestamp = new Map<string, Candle>();
  for (const list of lists) {
    for (const candle of list) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
}

export function aggregateCandles(
  candles: Candle[],
  interval: ChartInterval,
): Candle[] {
  if (interval === "1m" || interval === "1d") {
    return candles;
  }

  const minuteSize = MINUTE_INTERVALS[interval];
  if (minuteSize !== undefined) {
    return aggregateMinuteCandles(candles, minuteSize);
  }

  const bucketed = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = bucketStartMs(candle.timestamp, interval);
    if (bucket === null) {
      continue;
    }
    const group = bucketed.get(bucket) ?? [];
    group.push(candle);
    bucketed.set(bucket, group);
  }

  return Array.from(bucketed.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, group]) => mergeCandles(bucket, group));
}

function aggregateMinuteCandles(candles: Candle[], minuteSize: number): Candle[] {
  const bucketMs = minuteSize * 60_000;
  const bucketed = new Map<number, Candle[]>();
  for (const candle of candles) {
    const ms = Date.parse(candle.timestamp);
    if (Number.isNaN(ms)) {
      continue;
    }
    // Clock-aligned buckets (UTC epoch), so e.g. 5m candles fall on :00/:05/:10
    // rather than drifting from the first sample. Whole-hour market offsets (KST
    // +9, US -5/-4) keep these aligned to local minute marks too.
    const bucket = Math.floor(ms / bucketMs) * bucketMs;
    const group = bucketed.get(bucket) ?? [];
    group.push(candle);
    bucketed.set(bucket, group);
  }

  return Array.from(bucketed.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, group]) => mergeCandles(bucket, group));
}

function bucketStartMs(timestamp: string, interval: ChartInterval): number | null {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) {
    return null;
  }

  const date = new Date(ms);
  const localDate = calendarDateParts(timestamp) ?? {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
  if (interval === "1w") {
    const day = new Date(
      Date.UTC(localDate.year, localDate.month - 1, localDate.day),
    ).getUTCDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    return Date.UTC(
      localDate.year,
      localDate.month - 1,
      localDate.day - mondayOffset,
    );
  }
  if (interval === "1mo") {
    return Date.UTC(localDate.year, localDate.month - 1, 1);
  }
  return Date.UTC(localDate.year, 0, 1);
}

function calendarDateParts(
  timestamp: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(timestamp);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function mergeCandles(bucket: number, candles: Candle[]): Candle {
  const sorted = [...candles].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    timestamp: new Date(bucket).toISOString(),
    openPrice: first.openPrice,
    highPrice: maxDecimal(sorted.map((candle) => candle.highPrice)),
    lowPrice: minDecimal(sorted.map((candle) => candle.lowPrice)),
    closePrice: last.closePrice,
    volume: sorted.reduce(
      (sum, candle) => addDecimalStrings(sum, candle.volume),
      "0",
    ),
    currency: last.currency,
  };
}

// Number.isFinite guards below matter for the running accumulator, not just
// each candidate: with a plain `Number(value) > Number(max)` comparison, an
// unparseable first candle would seed `max`/`min` with NaN, and since any
// comparison against NaN is false, no later (valid) candle could ever replace
// it — the merged high/low would silently stay wrong for the whole bucket.

function maxDecimal(values: string[]): string {
  return values.reduce((max, value) => {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) return max;
    const parsedMax = Number(max);
    if (!Number.isFinite(parsedMax)) return value;
    return parsedValue > parsedMax ? value : max;
  });
}

function minDecimal(values: string[]): string {
  return values.reduce((min, value) => {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) return min;
    const parsedMin = Number(min);
    if (!Number.isFinite(parsedMin)) return value;
    return parsedValue < parsedMin ? value : min;
  });
}
