import type { Candle } from "@/lib/client/types";

// Pure, deterministic technical-indicator computations shared by client and
// server (no `server-only` marker, no clock/network/randomness) so the market
// advisor can feed the model computed numbers instead of leaving it to eyeball
// raw candles. Candle prices/volumes are decimal strings; they are parsed to
// numbers here. Self-contained SMA: the chart's `movingAverage`
// (app/_components/CandleChart.tsx) operates on lightweight-charts series, not
// `Candle[]`, so reusing it would pull chart types into this shared module.

const MA_PERIODS = [5, 20, 60] as const;
const RSI_PERIOD = 14;
const RECENT_WINDOW = 20;
const VOLUME_RECENT_WINDOW = 5;
const ATR_PERIOD = 14;

export interface MovingAveragePoint {
  period: number;
  value: number;
  /** Where the latest close sits relative to the average. */
  position: "above" | "below";
  /** Signed percent distance of the latest close from the average. */
  diffPct: number;
}

export interface VolumeTrend {
  recentAverage: number;
  overallAverage: number;
  /** recentAverage / overallAverage. */
  ratio: number;
  trend: "rising" | "falling" | "flat";
}

export interface Volatility {
  atr14?: number;
  /** (recentHigh - recentLow) / lastPrice * 100. */
  recentRangePct?: number;
}

export interface Indicators {
  lastPrice?: number;
  movingAverages: MovingAveragePoint[];
  rsi14?: number;
  recentHigh?: number;
  recentLow?: number;
  /** Number of trailing bars used for recentHigh/recentLow. */
  recentBars?: number;
  volume?: VolumeTrend;
  volatility?: Volatility;
}

/**
 * Compact higher-timeframe trend summary fed to the advisor alongside the
 * primary (lower) timeframe so it can judge a pullback against the larger
 * trend. Carries only a summary — never raw candles.
 */
export interface TrendSummary {
  /** The timeframe this summary describes (e.g. "1d"). */
  interval: string;
  direction: "up" | "down" | "flat";
  lastPrice: number;
  movingAverages: { period: number; value: number; position: "above" | "below" }[];
  recentHigh: number;
  recentLow: number;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAveragePoint(
  closes: number[],
  period: number,
  lastClose: number,
): MovingAveragePoint | null {
  if (closes.length < period) {
    return null;
  }
  const value = mean(closes.slice(-period));
  return {
    period,
    value: round(value, 2),
    position: lastClose >= value ? "above" : "below",
    diffPct: round(((lastClose - value) / value) * 100, 2),
  };
}

/**
 * RSI(14) using a simple (non-Wilder) average of the last `RSI_PERIOD` price
 * changes — deterministic and unit-testable. Needs at least `RSI_PERIOD + 1`
 * closes; returns null otherwise. 100 when there are no losses, 0 when no gains.
 */
function relativeStrengthIndex(closes: number[]): number | null {
  if (closes.length < RSI_PERIOD + 1) {
    return null;
  }
  const recent = closes.slice(-(RSI_PERIOD + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const delta = recent[i] - recent[i - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses -= delta;
    }
  }
  const avgGain = gains / RSI_PERIOD;
  const avgLoss = losses / RSI_PERIOD;
  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }
  if (avgGain === 0) {
    return 0;
  }
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 1);
}

function volumeTrend(volumes: number[]): VolumeTrend | null {
  if (volumes.length < VOLUME_RECENT_WINDOW) {
    return null;
  }
  const recentAverage = mean(volumes.slice(-VOLUME_RECENT_WINDOW));
  const overallAverage = mean(volumes);
  if (overallAverage === 0) {
    return null;
  }
  const ratio = recentAverage / overallAverage;
  const trend = ratio >= 1.2 ? "rising" : ratio <= 0.8 ? "falling" : "flat";
  return {
    recentAverage: round(recentAverage, 0),
    overallAverage: round(overallAverage, 0),
    ratio: round(ratio, 2),
    trend,
  };
}

/**
 * ATR(14): average true range over the last `ATR_PERIOD` bars. True range uses
 * the prior close, so it needs at least `ATR_PERIOD + 1` candles.
 */
function averageTrueRange(
  highs: number[],
  lows: number[],
  closes: number[],
): number | null {
  if (closes.length < ATR_PERIOD + 1) {
    return null;
  }
  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prevClose = closes[i - 1];
    trueRanges.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - prevClose),
        Math.abs(lows[i] - prevClose),
      ),
    );
  }
  return round(mean(trueRanges.slice(-ATR_PERIOD)), 2);
}

/**
 * Computes the technical-indicator block for one candle series. Each indicator
 * is independently gated on having enough bars; insufficient data omits that
 * field (rather than emitting a misleading value).
 */
export function computeIndicators(candles: Candle[]): Indicators {
  // Drop candles with an unparseable OHLCV field up front so a single bad bar
  // cannot turn every downstream indicator (MA/RSI/ATR/recentHigh) into NaN —
  // mirrors the finite-check `toChartSeries` applies for the same reason.
  const usable = candles.filter(
    (c) =>
      Number.isFinite(Number(c.closePrice)) &&
      Number.isFinite(Number(c.highPrice)) &&
      Number.isFinite(Number(c.lowPrice)) &&
      Number.isFinite(Number(c.volume)),
  );
  const closes = usable.map((c) => Number(c.closePrice));
  const highs = usable.map((c) => Number(c.highPrice));
  const lows = usable.map((c) => Number(c.lowPrice));
  const volumes = usable.map((c) => Number(c.volume));

  if (closes.length === 0) {
    return { movingAverages: [] };
  }

  const lastClose = closes[closes.length - 1];

  const movingAverages = MA_PERIODS.map((period) =>
    movingAveragePoint(closes, period, lastClose),
  ).filter((point): point is MovingAveragePoint => point !== null);

  const recentBars = Math.min(RECENT_WINDOW, usable.length);
  const recentHigh = round(Math.max(...highs.slice(-recentBars)), 2);
  const recentLow = round(Math.min(...lows.slice(-recentBars)), 2);

  const atr14 = averageTrueRange(highs, lows, closes) ?? undefined;
  const recentRangePct =
    lastClose !== 0
      ? round(((recentHigh - recentLow) / lastClose) * 100, 2)
      : undefined;
  const volatility: Volatility | undefined =
    atr14 !== undefined || recentRangePct !== undefined
      ? { atr14, recentRangePct }
      : undefined;

  return {
    lastPrice: round(lastClose, 2),
    movingAverages,
    rsi14: relativeStrengthIndex(closes) ?? undefined,
    recentHigh,
    recentLow,
    recentBars,
    volume: volumeTrend(volumes) ?? undefined,
    volatility,
  };
}

/**
 * Classifies trend direction. When both a short (5) and long (20) MA exist,
 * uses their relationship plus the close vs. the long MA; otherwise falls back
 * to the close's distance from whichever MA is available (±0.5% deadband).
 */
function trendDirection(
  lastPrice: number,
  movingAverages: { period: number; value: number }[],
): "up" | "down" | "flat" {
  const at = (period: number) => movingAverages.find((ma) => ma.period === period);
  const short = at(5);
  const long = at(20);
  if (short && long) {
    if (short.value > long.value && lastPrice >= long.value) {
      return "up";
    }
    if (short.value < long.value && lastPrice <= long.value) {
      return "down";
    }
    return "flat";
  }
  const ref = long ?? short;
  if (ref) {
    const diff = (lastPrice - ref.value) / ref.value;
    if (diff > 0.005) {
      return "up";
    }
    if (diff < -0.005) {
      return "down";
    }
  }
  return "flat";
}

/**
 * Builds a compact higher-timeframe trend summary from a candle series. Returns
 * null when the series is empty (no usable price). Deterministic and pure, so it
 * yields the same summary on the client (manual run) and server (worker).
 */
export function summarizeTrend(candles: Candle[], interval: string): TrendSummary | null {
  const indicators = computeIndicators(candles);
  if (
    indicators.lastPrice === undefined ||
    indicators.recentHigh === undefined ||
    indicators.recentLow === undefined
  ) {
    return null;
  }
  const movingAverages = indicators.movingAverages.map(({ period, value, position }) => ({
    period,
    value,
    position,
  }));
  return {
    interval,
    direction: trendDirection(indicators.lastPrice, movingAverages),
    lastPrice: indicators.lastPrice,
    movingAverages,
    recentHigh: indicators.recentHigh,
    recentLow: indicators.recentLow,
  };
}
