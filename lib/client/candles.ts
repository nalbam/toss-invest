import type { Candle } from "@/lib/client/types";
import { addDecimalStrings } from "@/lib/client/format";

export type TossCandleInterval = "1m" | "1d";

export type ChartInterval =
  | "1m"
  | "1d"
  | "1w"
  | "1mo"
  | "1y";

export const CHART_INTERVALS: ReadonlyArray<{
  value: ChartInterval;
  label: string;
}> = [
  { value: "1m", label: "분" },
  { value: "1d", label: "일" },
  { value: "1w", label: "주" },
  { value: "1mo", label: "월" },
  { value: "1y", label: "년" },
];

const MINUTE_INTERVALS: Partial<Record<ChartInterval, number>> = {
  "1m": 1,
};

export function sourceInterval(interval: ChartInterval): TossCandleInterval {
  return interval in MINUTE_INTERVALS ? "1m" : "1d";
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
  const sorted = [...candles]
    .map((candle) => ({ candle, ms: Date.parse(candle.timestamp) }))
    .filter((item) => !Number.isNaN(item.ms))
    .sort((a, b) => a.ms - b.ms);
  const first = sorted[0];
  if (first === undefined) {
    return [];
  }

  const bucketMs = minuteSize * 60_000;
  const bucketed = new Map<number, Candle[]>();
  for (const { candle, ms } of sorted) {
    const bucket = first.ms + Math.floor((ms - first.ms) / bucketMs) * bucketMs;
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

function maxDecimal(values: string[]): string {
  return values.reduce((max, value) =>
    Number(value) > Number(max) ? value : max,
  );
}

function minDecimal(values: string[]): string {
  return values.reduce((min, value) =>
    Number(value) < Number(min) ? value : min,
  );
}
