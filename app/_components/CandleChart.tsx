"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { MarketChartAnnotations } from "@/lib/client/market-advisor";
import type { Candle } from "@/lib/client/types";
import styles from "./dashboard.module.css";

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

function formatMarkerText(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 10 ? `${trimmed.slice(0, 10)}…` : trimmed;
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
 * the container. Data flows through the pure `toChartSeries` transform so the
 * conversion is testable independently of the canvas.
 */
export function CandleChart({
  candles,
  averagePurchasePrice,
  annotations,
}: {
  candles: Candle[];
  averagePurchasePrice?: string;
  annotations?: MarketChartAnnotations;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const averageLineRef = useRef<IPriceLine | null>(null);
  const annotationLineRefs = useRef<IPriceLine[]>([]);

  // Create the chart once on mount and tear it down on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = createChart(container, {
      height: 420,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#7b818c" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.07)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#ff4d6d",
      downColor: "#3b82f6",
      borderVisible: false,
      wickUpColor: "#ff4d6d",
      wickDownColor: "#3b82f6",
      priceFormat: {
        type: "custom",
        minMove: 0.0001,
        formatter: formatChartPrice,
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markerRef.current = createSeriesMarkers(series, []);
    return () => {
      markerRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markerRef.current = null;
      averageLineRef.current = null;
      annotationLineRefs.current = [];
    };
  }, []);

  // Push converted data whenever the candles change.
  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    series.setData(toChartSeries(candles));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

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
      lineWidth: 2 as const,
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
    if (annotations === undefined) {
      markerRef.current?.setMarkers([]);
      return;
    }
    const supportLines = annotations.supportLevels.map((item) =>
      series.createPriceLine({
        price: item.price,
        color: "#64748b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: item.label,
      }),
    );
    const resistanceLines = annotations.resistanceLevels.map((item) =>
      series.createPriceLine({
        price: item.price,
        color: "#94a3b8",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: item.label,
      }),
    );
    annotationLineRefs.current = [...supportLines, ...resistanceLines];
    const markers = annotations.markers
      .flatMap<SeriesMarker<Time>>((item) => {
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
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    markerRef.current?.setMarkers(markers);
  }, [annotations]);

  return <div ref={containerRef} className={styles.chart} aria-label="캔들 차트" />;
}
