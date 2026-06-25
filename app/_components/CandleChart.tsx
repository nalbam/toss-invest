"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  TickMarkType,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  MarketAdvisorHistoryEvent,
  MarketChartAnnotations,
} from "@/lib/client/market-advisor";
import type { Candle, Order, PriceLimitResponse } from "@/lib/client/types";
import styles from "./dashboard.module.css";

/** A buy/sell execution marker placed on the candle series at a given time. */
export interface ChartMarker {
  time: UTCTimestamp;
  side: "BUY" | "SELL";
}

// Korean convention: red = up, blue = down.
const UP_COLOR = "#ff4d6d";
const DOWN_COLOR = "#3b82f6";
const VOLUME_UP_COLOR = "rgba(255,77,109,0.5)";
const VOLUME_DOWN_COLOR = "rgba(59,130,246,0.5)";
// Distinct colors for the moving-average overlay lines, indexed by MA order.
const MA_COLORS = ["#f5a623", "#a855f7", "#22d3ee"];
const DEFAULT_MA_PERIODS = [5, 20];

/** Trigger older-data loading once the leftmost visible bar is within N bars of
 *  the oldest loaded candle, so history streams in before the user hits the edge. */
const LOAD_OLDER_THRESHOLD_BARS = 10;

/**
 * Converts API candles (string OHLCV, ISO/epoch timestamp) into the numeric
 * series shape lightweight-charts expects. Pure and side-effect free so it can
 * be unit-tested without a canvas; the chart rendering itself lives in the
 * `useEffect` below.
 *
 * - String OHLC values are parsed to numbers only here (storage stays string).
 * - Candles with an unparseable timestamp or price are dropped rather than
 *   feeding `NaN` into the chart.
 * - Output is sorted ascending by time and de-duplicated (last value wins),
 *   because lightweight-charts requires strictly increasing, unique times.
 */
export function toChartSeries(candles: Candle[]): CandlestickData[] {
  const byTime = new Map<number, CandlestickData>();
  for (const candle of candles) {
    const time = parseTimestampSeconds(candle.timestamp);
    if (time === null) {
      continue;
    }
    const open = Number(candle.openPrice);
    const high = Number(candle.highPrice);
    const low = Number(candle.lowPrice);
    const close = Number(candle.closePrice);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    byTime.set(time, {
      time: time as UTCTimestamp,
      open,
      high,
      low,
      close,
    });
  }
  return Array.from(byTime.values()).sort(
    (a, b) => (a.time as number) - (b.time as number),
  );
}

export function formatChartPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(price);
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/**
 * Series timestamps are true Unix seconds (UTC epoch), but lightweight-charts
 * renders them in UTC by default — showing KST candles 9h behind. These
 * formatters render the crosshair label and axis ticks in the viewer's local
 * time so the displayed wall-clock matches the market (and the advisor box's
 * "조언 일시"). Only labels change; the series time base is untouched, so marker
 * and advice-line positioning are unaffected.
 */
function formatCrosshairTime(time: Time): string {
  if (typeof time !== "number") {
    return "";
  }
  const date = new Date(time * 1000);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

function formatTickMark(time: Time, tickMarkType: TickMarkType): string {
  if (typeof time !== "number") {
    return "";
  }
  const date = new Date(time * 1000);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return `${date.getFullYear()}`;
    case TickMarkType.Month:
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    case TickMarkType.DayOfMonth:
      return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    case TickMarkType.Time:
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    case TickMarkType.TimeWithSeconds:
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    default:
      return "";
  }
}

function formatMarkerText(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 10 ? `${trimmed.slice(0, 10)}…` : trimmed;
}

function decisionColor(action: MarketAdvisorHistoryEvent["decision"]["action"]): string {
  if (action === "buy") return "var(--gain)";
  if (action === "sell") return "var(--loss)";
  if (action === "hold") return "var(--foreground)";
  return "var(--muted)";
}

/**
 * Volume bars keyed by candle time, colored by the candle's direction (close vs
 * open). Mirrors `toChartSeries`' parse/sort/dedupe rules — including dropping
 * candles with any non-finite OHLC value — so the volume axis stays aligned
 * with the candles. Candles with an unparseable timestamp or volume are dropped.
 */
export function toVolumeSeries(candles: Candle[]): HistogramData[] {
  const byTime = new Map<number, HistogramData>();
  for (const candle of candles) {
    const time = parseTimestampSeconds(candle.timestamp);
    if (time === null) {
      continue;
    }
    const volume = Number(candle.volume);
    const open = Number(candle.openPrice);
    const high = Number(candle.highPrice);
    const low = Number(candle.lowPrice);
    const close = Number(candle.closePrice);
    if (
      !Number.isFinite(volume) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    const color = close >= open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR;
    byTime.set(time, { time: time as UTCTimestamp, value: volume, color });
  }
  return Array.from(byTime.values()).sort(
    (a, b) => (a.time as number) - (b.time as number),
  );
}

/**
 * Simple moving average of close prices over `period`, aligned to candle time.
 * Operates on the already-converted candlestick series so timestamps are parsed
 * only once. Returns one point per window starting once `period` closes are
 * available; an empty array when the series is shorter than `period`.
 */
export function movingAverage(
  series: CandlestickData[],
  period: number,
): LineData[] {
  if (period <= 0 || series.length < period) {
    return [];
  }
  const out: LineData[] = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i].close;
    if (i >= period) {
      sum -= series[i - period].close;
    }
    if (i >= period - 1) {
      out.push({ time: series[i].time, value: sum / period });
    }
  }
  return out;
}

/**
 * Builds buy/sell execution markers for `symbol` from the order list. Only
 * orders that filled (a parseable `execution.filledAt`) for the given symbol
 * are kept, sorted ascending by time as lightweight-charts requires. Pure for
 * unit testing.
 */
export function toOrderMarkers(orders: Order[], symbol: string): ChartMarker[] {
  const markers: ChartMarker[] = [];
  for (const order of orders) {
    if (order.symbol !== symbol || order.execution.filledAt === null) {
      continue;
    }
    const time = parseTimestampSeconds(order.execution.filledAt);
    if (time === null) {
      continue;
    }
    const side = order.side === "SELL" ? "SELL" : "BUY";
    markers.push({ time: time as UTCTimestamp, side });
  }
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Maps domain markers to lightweight-charts markers (buy below, sell above). */
function buildSeriesMarkers(markers: ChartMarker[]): SeriesMarker<Time>[] {
  return markers.map((marker) =>
    marker.side === "BUY"
      ? {
          time: marker.time,
          position: "belowBar",
          color: UP_COLOR,
          shape: "arrowUp",
          text: "매수",
        }
      : {
          time: marker.time,
          position: "aboveBar",
          color: DOWN_COLOR,
          shape: "arrowDown",
          text: "매도",
        },
  );
}

/**
 * Parses a candle timestamp into Unix seconds. Accepts an ISO date-time string
 * or a numeric epoch string (seconds or milliseconds). Returns null when the
 * value cannot be parsed.
 */
function parseTimestampSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    // Heuristic: 13-digit values are milliseconds, 10-digit are seconds.
    return trimmed.length >= 13 ? Math.floor(num / 1000) : num;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function timestampOffsetMinutes(value: string): number | null {
  if (value.endsWith("Z")) {
    return 0;
  }
  const match = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function dateKeyInOffset(value: string, offsetMinutes: number): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function chartTimeRange(candles: Candle[], series: CandlestickData[]): {
  min: number;
  max: number;
  times: number[];
  step: number;
  dateTimes: Map<string, { time: number; offsetMinutes: number }>;
} | null {
  const times = series
    .map((item) => item.time)
    .flatMap((time) => (typeof time === "number" ? [time] : []));
  const first = times.at(0);
  const last = times.at(-1);
  if (typeof first !== "number" || typeof last !== "number") {
    return null;
  }
  const gaps = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((gap) => gap > 0);
  const dateTimes = new Map<string, { time: number; offsetMinutes: number }>();
  for (const candle of candles) {
    const time = parseTimestampSeconds(candle.timestamp);
    const offsetMinutes = timestampOffsetMinutes(candle.timestamp);
    if (time === null || offsetMinutes === null) {
      continue;
    }
    const key = dateKeyInOffset(candle.timestamp, offsetMinutes);
    if (key !== null) {
      dateTimes.set(key, { time, offsetMinutes });
    }
  }
  return { min: first, max: last, times, step: Math.min(...gaps, 60), dateTimes };
}

function nearestChartTime(time: number, range: {
  times: number[];
  step: number;
}): number | null {
  let nearest: { time: number; distance: number } | null = null;
  for (const chartTime of range.times) {
    const distance = Math.abs(chartTime - time);
    if (nearest === null || distance < nearest.distance) {
      nearest = { time: chartTime, distance };
    }
  }
  if (nearest === null || nearest.distance > range.step) {
    return null;
  }
  return nearest.time;
}

function chartTimeForGeneratedDate(
  generatedAt: string,
  range: { dateTimes: Map<string, { time: number; offsetMinutes: number }> },
): number | null {
  for (const [dateKey, item] of range.dateTimes) {
    const generatedDateKey = dateKeyInOffset(
      generatedAt,
      item.offsetMinutes,
    );
    if (generatedDateKey === dateKey) {
      return item.time;
    }
  }
  return null;
}

/**
 * Candlestick chart for a symbol. The chart canvas is created imperatively via
 * a ref in `useEffect` (lightweight-charts owns the DOM); React only renders
 * the container. Data flows through pure transforms (`toChartSeries`,
 * `toVolumeSeries`, `movingAverage`) so the conversions are testable
 * independently of the canvas.
 *
 * Overlays: a bottom volume histogram (`showVolume`), one moving-average line
 * per `maPeriods` entry, and dashed upper/lower price-limit lines when
 * `priceLimits` is provided (US stocks have null limits, which are skipped).
 */
export function CandleChart({
  candles,
  priceLimits,
  markers,
  showVolume = true,
  maPeriods = DEFAULT_MA_PERIODS,
  averagePurchasePrice,
  annotations,
  advisorEvents = [],
  showAnnotationLabels = true,
  showAnnotationLines = true,
  showAdviceLines = true,
  onReachStart,
  fitKey,
}: {
  candles: Candle[];
  priceLimits?: PriceLimitResponse | null;
  markers?: ChartMarker[];
  showVolume?: boolean;
  maPeriods?: number[];
  averagePurchasePrice?: string;
  annotations?: MarketChartAnnotations;
  advisorEvents?: MarketAdvisorHistoryEvent[];
  showAnnotationLabels?: boolean;
  showAnnotationLines?: boolean;
  showAdviceLines?: boolean;
  /**
   * Called when the user scrolls near the left (oldest) edge, so the parent can
   * append older candles. The chart preserves its view on those updates (see
   * `fitKey`) instead of re-fitting, which would reset the scroll and re-trigger.
   */
  onReachStart?: () => void;
  /**
   * Identity of the current dataset (e.g. `symbol:interval`). The chart fits all
   * content only when this changes; on same-key updates (older pages prepended,
   * live ticks) it keeps the current view. Omit to always fit (legacy behaviour).
   */
  fitKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adviceOverlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRefs = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const averageLineRef = useRef<IPriceLine | null>(null);
  const annotationLineRefs = useRef<IPriceLine[]>([]);
  const chartTimeRangeRef = useRef<{
    min: number;
    max: number;
    times: number[];
    step: number;
    dateTimes: Map<string, { time: number; offsetMinutes: number }>;
  } | null>(null);
  // Latest onReachStart, read by the once-registered range subscription so it
  // always calls the current callback without re-subscribing.
  const onReachStartRef = useRef(onReachStart);
  onReachStartRef.current = onReachStart;
  // Dataset identity the chart last fit to; fitContent runs only when it changes.
  const fitKeyRef = useRef<string | undefined>(undefined);
  // Visible bar count (logical-range span) the user last viewed. Restored on a
  // dataset switch so the horizontal zoom — how many bars are shown — stays
  // constant across symbol/interval changes instead of re-fitting to a different
  // bar count per dataset.
  const visibleBarSpanRef = useRef<number | null>(null);

  const renderAdviceLines = useCallback(() => {
    const chart = chartRef.current;
    const overlay = adviceOverlayRef.current;
    if (chart === null || overlay === null) {
      return;
    }
    overlay.replaceChildren();
    if (!showAdviceLines) {
      return;
    }
    const range = chartTimeRangeRef.current;
    if (range === null) {
      return;
    }
    // timeToCoordinate is relative to the plot (series) area, but the overlay
    // spans the whole container. The price axis/labels sit on the left, so shift
    // each marker right by the left price-scale width to align it with its candle.
    const leftPad = chart.priceScale("left").width();
    // Draw each advice as a dot at the top of the plot, sized to the candle
    // width (bar spacing), so it marks the time without crossing the candles.
    const barSpacing = chart.timeScale().options().barSpacing;
    const dotSize = Math.max(4, Math.min(barSpacing, 24));

    // Analysis-range band for the latest advice: a thin bar at the top spanning
    // the candles it actually analyzed (oldest → latest), so the run-time dot's
    // recency isn't mistaken for the analyzed window. Drawn first (behind dots).
    const latest = advisorEvents[0];
    if (latest?.chartFrom != null && latest.chartTimestamp !== null) {
      const fromSeconds = parseTimestampSeconds(latest.chartFrom);
      const toSeconds = parseTimestampSeconds(latest.chartTimestamp);
      if (fromSeconds !== null && toSeconds !== null) {
        const x1 = chart
          .timeScale()
          .timeToCoordinate(Math.max(fromSeconds, range.min) as Time);
        const x2 = chart
          .timeScale()
          .timeToCoordinate(Math.min(toSeconds, range.max) as Time);
        if (x1 !== null && x2 !== null && x2 > x1) {
          const band = document.createElement("span");
          band.className = styles.chartAnalysisRange;
          band.style.left = `${leftPad + x1}px`;
          band.style.width = `${x2 - x1}px`;
          band.style.setProperty(
            "--advice-line-color",
            decisionColor(latest.decision.action),
          );
          band.title =
            latest.candleCount != null
              ? `분석 구간 (${latest.candleCount}봉)`
              : "분석 구간";
          overlay.append(band);
        }
      }
    }

    for (const event of advisorEvents) {
      const generatedSeconds = parseTimestampSeconds(event.generatedAt);
      const chartSeconds =
        event.chartTimestamp === null
          ? null
          : parseTimestampSeconds(event.chartTimestamp);
      const seconds =
        generatedSeconds === null
          ? chartSeconds
          : event.interval === "1d"
            ? chartTimeForGeneratedDate(event.generatedAt, range) ??
              nearestChartTime(generatedSeconds, range) ??
              chartSeconds
            : nearestChartTime(generatedSeconds, range) ?? chartSeconds;
      if (seconds === null || seconds < range.min || seconds > range.max) {
        continue;
      }
      const coordinate = chart.timeScale().timeToCoordinate(seconds as Time);
      if (coordinate === null) {
        continue;
      }
      const marker = document.createElement("span");
      marker.className = styles.chartAdviceMarker;
      marker.style.left = `${leftPad + coordinate}px`;
      marker.style.width = `${dotSize}px`;
      marker.style.height = `${dotSize}px`;
      marker.style.setProperty("--advice-line-color", decisionColor(event.decision.action));
      marker.title = `${event.decision.label}: ${event.decision.reason}`;
      overlay.append(marker);
    }
  }, [advisorEvents, showAdviceLines]);

  // Create the chart and its series once; recreate only if the overlay shape
  // (volume toggle or number of MA lines) changes. Defaults have stable
  // identities, so for the common case this runs only on mount.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = createChart(container, {
      height: 420,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#7b818c" },
      localization: { timeFormatter: formatCrosshairTime },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.07)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        tickMarkFormatter: formatTickMark,
      },
      // Price axis (and its price-line labels: 평균단가/지지/저항) on the left
      // so the labels don't cover the most recent candles on the right.
      leftPriceScale: { visible: true },
      rightPriceScale: { visible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      priceFormat: {
        type: "custom",
        minMove: 0.0001,
        formatter: formatChartPrice,
      },
      priceScaleId: "left",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markerRef.current = createSeriesMarkers(series, []);

    if (showVolume) {
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // Pin the volume bars to the bottom 20% so they don't overlap the candles.
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeRef.current = volume;
    }

    maRefs.current = maPeriods.map((_, index) =>
      chart.addSeries(LineSeries, {
        color: MA_COLORS[index % MA_COLORS.length],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceScaleId: "left",
      }),
    );

    return () => {
      markerRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      maRefs.current = [];
      priceLinesRef.current = [];
      markerRef.current = null;
      averageLineRef.current = null;
      annotationLineRefs.current = [];
    };
  }, [showVolume, maPeriods]);

  // Push converted data whenever the candles change.
  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    const chartSeries = toChartSeries(candles);
    chartTimeRangeRef.current = chartTimeRange(candles, chartSeries);
    series.setData(chartSeries);
    volumeRef.current?.setData(toVolumeSeries(candles));
    maRefs.current.forEach((ma, index) => {
      ma.setData(movingAverage(chartSeries, maPeriods[index] ?? 0));
    });
    // On a new dataset (symbol/interval change) keep the horizontal zoom the
    // user chose: restore the same visible bar count, anchored to the latest
    // bar, instead of fitContent — which would show a different number of bars
    // per dataset. Fall back to fitContent before any view is recorded (first
    // mount) or with no fitKey (legacy callers). On same-key updates — older
    // pages prepended or live ticks — keep the current view so the scroll
    // position holds and older-loading doesn't loop.
    if (fitKey === undefined || fitKeyRef.current !== fitKey) {
      const timeScale = chartRef.current?.timeScale();
      const span = visibleBarSpanRef.current;
      const total = chartSeries.length;
      if (timeScale != null && span != null && span > 0 && total > 0) {
        timeScale.setVisibleLogicalRange({ from: total - span, to: total });
      } else {
        timeScale?.fitContent();
      }
      fitKeyRef.current = fitKey;
    }
    renderAdviceLines();
  }, [candles, maPeriods, renderAdviceLines, fitKey]);

  // Redraw the dashed upper/lower price-limit lines when the limits change.
  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = [];
    if (!priceLimits) {
      return;
    }
    const lines: IPriceLine[] = [];
    const upper = Number(priceLimits.upperLimitPrice);
    if (priceLimits.upperLimitPrice !== null && Number.isFinite(upper)) {
      lines.push(
        series.createPriceLine({
          price: upper,
          color: UP_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "상한가",
        }),
      );
    }
    const lower = Number(priceLimits.lowerLimitPrice);
    if (priceLimits.lowerLimitPrice !== null && Number.isFinite(lower)) {
      lines.push(
        series.createPriceLine({
          price: lower,
          color: DOWN_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "하한가",
        }),
      );
    }
    priceLinesRef.current = lines;
  }, [priceLimits]);

  useEffect(() => {
    renderAdviceLines();
  }, [renderAdviceLines]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) {
      return;
    }
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(renderAdviceLines);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(renderAdviceLines);
    };
  }, [renderAdviceLines]);

  // Auto-load older candles: when the leftmost visible bar nears the oldest
  // loaded candle, ask the parent for an earlier page. Registered once per chart
  // (deps mirror the chart-creation effect) and reads the latest callback via a ref.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) {
      return;
    }
    const timeScale = chart.timeScale();
    const handler = (range: { from: number; to: number } | null) => {
      if (range == null) {
        return;
      }
      // Remember how many bars are shown so a dataset switch can restore it.
      visibleBarSpanRef.current = range.to - range.from;
      if (range.from < LOAD_OLDER_THRESHOLD_BARS) {
        onReachStartRef.current?.();
      }
    };
    timeScale.subscribeVisibleLogicalRangeChange(handler);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, [showVolume, maPeriods]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    const price =
      averagePurchasePrice === undefined ? Number.NaN : Number(averagePurchasePrice);
    if (!Number.isFinite(price)) {
      if (averageLineRef.current !== null) {
        series.removePriceLine(averageLineRef.current);
        averageLineRef.current = null;
      }
      return;
    }
    const options = {
      price,
      color: "#f59e0b",
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "평균단가",
    };
    if (averageLineRef.current === null) {
      averageLineRef.current = series.createPriceLine(options);
    } else {
      averageLineRef.current.applyOptions(options);
    }
  }, [averagePurchasePrice]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    for (const line of annotationLineRefs.current) {
      series.removePriceLine(line);
    }
    annotationLineRefs.current = [];
    // Buy/sell execution markers are always shown; advisor annotation markers
    // are merged in when annotations are present. Both share the one marker
    // plugin attached to the candle series.
    const orderMarkers = buildSeriesMarkers(markers ?? []);
    if (annotations === undefined) {
      markerRef.current?.setMarkers(orderMarkers);
      return;
    }
    const supportLines = annotations.supportLevels.map((item) =>
      series.createPriceLine({
        price: item.price,
        color: "#64748b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: showAnnotationLines,
        axisLabelVisible: showAnnotationLabels,
        title: showAnnotationLabels ? item.label : "",
      }),
    );
    const resistanceLines = annotations.resistanceLevels.map((item) =>
      series.createPriceLine({
        price: item.price,
        color: "#94a3b8",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: showAnnotationLines,
        axisLabelVisible: showAnnotationLabels,
        title: showAnnotationLabels ? item.label : "",
      }),
    );
    annotationLineRefs.current = [...supportLines, ...resistanceLines];
    const annotationMarkers = annotations.markers.flatMap<SeriesMarker<Time>>(
      (item) => {
        const time = parseTimestampSeconds(item.timestamp);
        if (time === null) {
          return [];
        }
        return [
          {
            time: time as UTCTimestamp,
            position: item.position,
            color: "#0f9f6e",
            shape: "circle",
            size: 0.6,
            text: formatMarkerText(item.label),
          },
        ];
      },
    );
    markerRef.current?.setMarkers(
      [...orderMarkers, ...annotationMarkers].sort(
        (a, b) => (a.time as number) - (b.time as number),
      ),
    );
  }, [markers, annotations, showAnnotationLabels, showAnnotationLines]);

  return (
    <div ref={containerRef} className={styles.chart} aria-label="캔들 차트">
      <div ref={adviceOverlayRef} className={styles.chartAdviceOverlay} />
    </div>
  );
}
