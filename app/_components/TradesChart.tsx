"use client";

import { useEffect, useRef } from "react";
import {
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Trade } from "@/lib/client/types";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

const LINE_COLOR = "#22d3ee";

/**
 * Converts recent trades into a price line keyed by trade time. lightweight-
 * charts requires strictly increasing, unique times, so trades are bucketed to
 * the second (last trade in a second wins) and sorted ascending. Trades with an
 * unparseable timestamp or price are dropped. Pure for unit testing.
 */
export function toTradeSeries(trades: Trade[]): LineData[] {
  const byTime = new Map<number, LineData>();
  for (const trade of trades) {
    const time = parseTimestampSeconds(trade.timestamp);
    if (time === null) {
      continue;
    }
    const price = Number(trade.price);
    if (!Number.isFinite(price)) {
      continue;
    }
    byTime.set(time, { time: time as UTCTimestamp, value: price });
  }
  return Array.from(byTime.values()).sort(
    (a, b) => (a.time as number) - (b.time as number),
  );
}

/** Parses a trade timestamp into Unix seconds (ISO or numeric epoch), or null. */
function parseTimestampSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return trimmed.length >= 13 ? Math.floor(num / 1000) : num;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Line chart of the most recent trade prices for the selected symbol. Mirrors
 * `CandleChart`'s imperative lifecycle: the chart is created once via a ref and
 * fed the pure `toTradeSeries` transform whenever the trades change.
 */
export function TradesChart({
  trades,
  refreshing,
}: {
  trades: Trade[];
  refreshing?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = createChart(container, {
      height: 160,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#7b818c" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.07)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      timeScale: { timeVisible: true, secondsVisible: true },
    });
    const series = chart.addSeries(LineSeries, {
      color: LINE_COLOR,
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) {
      return;
    }
    series.setData(toTradeSeries(trades));
    chartRef.current?.timeScale().fitContent();
  }, [trades]);

  return (
    <CollapsibleCard title="체결 추이" storageId="trades-chart" refreshing={refreshing}>
      <div ref={containerRef} className={styles.depthSvg} aria-label="체결 추이 차트" />
    </CollapsibleCard>
  );
}
