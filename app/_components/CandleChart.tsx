"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
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

/**
 * Volume bars keyed by candle time, colored by the candle's direction (close vs
 * open). Mirrors `toChartSeries`' parse/sort/dedupe rules so the volume axis
 * stays aligned with the candles. Candles with an unparseable timestamp or
 * volume are dropped.
 */
export function toVolumeSeries(candles: Candle[]): HistogramData[] {
  const byTime = new Map<number, HistogramData>();
  for (const candle of candles) {
    const time = parseTimestampSeconds(candle.timestamp);
    if (time === null) {
      continue;
    }
    const volume = Number(candle.volume);
    if (!Number.isFinite(volume)) {
      continue;
    }
    const open = Number(candle.openPrice);
    const close = Number(candle.closePrice);
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
}: {
  candles: Candle[];
  priceLimits?: PriceLimitResponse | null;
  markers?: ChartMarker[];
  showVolume?: boolean;
  maPeriods?: number[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRefs = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Create the chart and its series once; recreate only if the overlay shape
  // (volume toggle or number of MA lines) changes. Defaults have stable
  // identities, so for the common case this runs only on mount.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = createChart(container, {
      height: 280,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#7b818c" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.07)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

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
      }),
    );

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      maRefs.current = [];
      priceLinesRef.current = [];
      markersRef.current = null;
    };
  }, [showVolume, maPeriods]);

  // Push converted data whenever the candles change.
  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    const chartSeries = toChartSeries(candles);
    series.setData(chartSeries);
    volumeRef.current?.setData(toVolumeSeries(candles));
    maRefs.current.forEach((ma, index) => {
      ma.setData(movingAverage(chartSeries, maPeriods[index] ?? 0));
    });
    chartRef.current?.timeScale().fitContent();
  }, [candles, maPeriods]);

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

  // Update the buy/sell execution markers when they change.
  useEffect(() => {
    markersRef.current?.setMarkers(buildSeriesMarkers(markers ?? []));
  }, [markers]);

  return <div ref={containerRef} className={styles.chart} aria-label="캔들 차트" />;
}
