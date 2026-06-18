// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Candle } from "@/lib/client/types";

// jsdom has no canvas, so the chart library is mocked. The component is exercised
// only for mount + `series.setData(...)` wiring; real canvas rendering is out of
// scope and would otherwise throw in jsdom.
const setData = vi.fn();
const fitContent = vi.fn();
const addSeries = vi.fn(() => ({ setData }));
const remove = vi.fn();
const createChart = vi.fn(() => ({
  addSeries,
  timeScale: () => ({ fitContent }),
  remove,
}));

vi.mock("lightweight-charts", () => ({
  createChart,
  CandlestickSeries: "CandlestickSeries",
}));

// Imported after the mock is registered so the component picks up the stub.
const { CandleChart, toChartSeries } = await import("./CandleChart");

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    timestamp: "2026-03-25T09:00:00+09:00",
    openPrice: "100",
    highPrice: "110",
    lowPrice: "95",
    closePrice: "105",
    volume: "1000",
    currency: "KRW",
    ...overrides,
  };
}

describe("toChartSeries", () => {
  it("converts string OHLCV to numbers with epoch-second time", () => {
    const series = toChartSeries([candle()]);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      open: 100,
      high: 110,
      low: 95,
      close: 105,
    });
    expect(typeof series[0].time).toBe("number");
  });

  it("returns an empty array for empty input", () => {
    expect(toChartSeries([])).toEqual([]);
  });

  it("drops candles with unparseable timestamp or price", () => {
    const series = toChartSeries([
      candle({ timestamp: "not-a-date" }),
      candle({ timestamp: "2026-03-26T09:00:00+09:00", closePrice: "abc" }),
      candle({ timestamp: "2026-03-27T09:00:00+09:00" }),
    ]);
    expect(series).toHaveLength(1);
  });

  it("parses a numeric millisecond epoch string", () => {
    const series = toChartSeries([candle({ timestamp: "1700000000000" })]);
    expect(series[0].time).toBe(1700000000);
  });

  it("sorts ascending and de-duplicates identical times (last wins)", () => {
    const series = toChartSeries([
      candle({ timestamp: "1700000200", closePrice: "200" }),
      candle({ timestamp: "1700000100", closePrice: "100" }),
      candle({ timestamp: "1700000200", closePrice: "299" }),
    ]);
    expect(series.map((point) => point.time)).toEqual([
      1700000100, 1700000200,
    ]);
    expect(series[1]).toMatchObject({ close: 299 });
  });
});

describe("CandleChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("mounts and feeds the converted series to the chart", () => {
    render(<CandleChart candles={[candle()]} />);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledTimes(1);
    const [series] = setData.mock.calls[0];
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ open: 100, close: 105 });
  });

  it("removes the chart on unmount", () => {
    const { unmount } = render(<CandleChart candles={[]} />);
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
