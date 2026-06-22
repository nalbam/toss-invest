// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Candle, Order, PriceLimitResponse } from "@/lib/client/types";

// jsdom has no canvas, so the chart library is mocked. The component is exercised
// only for mount + `series.setData(...)` / overlay wiring; real canvas rendering
// is out of scope and would otherwise throw in jsdom.
const setData = vi.fn();
const fitContent = vi.fn();
const applyOptions = vi.fn();
const priceScale = vi.fn(() => ({ applyOptions }));
const createPriceLine = vi.fn((options) => ({ options }));
const removePriceLine = vi.fn();
const addSeries = vi.fn(() => ({
  setData,
  priceScale,
  createPriceLine,
  removePriceLine,
}));
const remove = vi.fn();
const createChart = vi.fn(() => ({
  addSeries,
  timeScale: () => ({ fitContent }),
  remove,
}));
const setMarkers = vi.fn();
const createSeriesMarkers = vi.fn(() => ({ setMarkers }));

vi.mock("lightweight-charts", () => ({
  createChart,
  createSeriesMarkers,
  CandlestickSeries: "CandlestickSeries",
  HistogramSeries: "HistogramSeries",
  LineSeries: "LineSeries",
  LineStyle: { Dashed: 2 },
}));

// Imported after the mock is registered so the component picks up the stub.
const { CandleChart, toChartSeries, toVolumeSeries, movingAverage, toOrderMarkers } =
  await import("./CandleChart");

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

describe("toVolumeSeries", () => {
  it("colors bars red when close >= open and blue otherwise", () => {
    const series = toVolumeSeries([
      candle({ timestamp: "1700000100", openPrice: "100", closePrice: "105" }),
      candle({ timestamp: "1700000200", openPrice: "100", closePrice: "95" }),
    ]);
    expect(series[0]).toMatchObject({ value: 1000, color: "rgba(255,77,109,0.5)" });
    expect(series[1]).toMatchObject({ value: 1000, color: "rgba(59,130,246,0.5)" });
  });

  it("drops candles with unparseable timestamp or volume", () => {
    const series = toVolumeSeries([
      candle({ timestamp: "not-a-date" }),
      candle({ timestamp: "1700000100", volume: "abc" }),
      candle({ timestamp: "1700000200" }),
    ]);
    expect(series).toHaveLength(1);
  });
});

describe("movingAverage", () => {
  it("returns an empty array when the series is shorter than the period", () => {
    const series = toChartSeries([
      candle({ timestamp: "1700000100" }),
      candle({ timestamp: "1700000200" }),
    ]);
    expect(movingAverage(series, 3)).toEqual([]);
    expect(movingAverage(series, 0)).toEqual([]);
  });

  it("averages the trailing window of closes per point", () => {
    const series = toChartSeries([
      candle({ timestamp: "1700000100", closePrice: "10" }),
      candle({ timestamp: "1700000200", closePrice: "20" }),
      candle({ timestamp: "1700000300", closePrice: "30" }),
      candle({ timestamp: "1700000400", closePrice: "40" }),
    ]);
    const ma = movingAverage(series, 2);
    expect(ma.map((point) => point.value)).toEqual([15, 25, 35]);
    expect(ma[0].time).toBe(1700000200);
  });
});

function order(overrides: Partial<Order> = {}): Order {
  return {
    orderId: "o1",
    symbol: "AAPL",
    side: "BUY",
    orderType: "LIMIT",
    timeInForce: "DAY",
    status: "FILLED",
    price: "190",
    quantity: "1",
    orderAmount: null,
    currency: "USD",
    orderedAt: "2026-03-25T09:00:00+09:00",
    canceledAt: null,
    execution: {
      filledQuantity: "1",
      averageFilledPrice: "190",
      filledAmount: "190",
      commission: null,
      tax: null,
      filledAt: "1700000200",
      settlementDate: null,
    },
    ...overrides,
  };
}

describe("toOrderMarkers", () => {
  it("keeps only filled orders for the symbol, sorted ascending by time", () => {
    const markers = toOrderMarkers(
      [
        order({ orderId: "a", side: "SELL", execution: { ...order().execution, filledAt: "1700000300" } }),
        order({ orderId: "b", side: "BUY", execution: { ...order().execution, filledAt: "1700000100" } }),
        order({ orderId: "c", symbol: "MSFT" }),
        order({ orderId: "d", execution: { ...order().execution, filledAt: null } }),
      ],
      "AAPL",
    );
    expect(markers).toEqual([
      { time: 1700000100, side: "BUY" },
      { time: 1700000300, side: "SELL" },
    ]);
  });

  it("returns an empty array when no order matches", () => {
    expect(toOrderMarkers([order({ symbol: "MSFT" })], "AAPL")).toEqual([]);
  });
});

describe("CandleChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("mounts with candle, volume, and MA series and feeds converted data", () => {
    render(<CandleChart candles={[candle()]} />);
    expect(createChart).toHaveBeenCalledTimes(1);
    // candle + volume + 2 default MA lines
    expect(addSeries).toHaveBeenCalledTimes(4);
    const [, candleOptions] = addSeries.mock.calls[0] as unknown as [
      unknown,
      unknown,
    ];
    expect(candleOptions).toMatchObject({
      upColor: "#ff4d6d",
      downColor: "#3b82f6",
      wickUpColor: "#ff4d6d",
      wickDownColor: "#3b82f6",
    });
    // setData on each series (candle + volume + 2 MA).
    expect(setData).toHaveBeenCalledTimes(4);
    const [candleSeries] = setData.mock.calls[0];
    expect(candleSeries).toHaveLength(1);
    expect(candleSeries[0]).toMatchObject({ open: 100, close: 105 });
  });

  it("omits the volume series when showVolume is false", () => {
    render(<CandleChart candles={[candle()]} showVolume={false} maPeriods={[]} />);
    expect(addSeries).toHaveBeenCalledTimes(1);
  });

  it("draws dashed upper/lower price-limit lines when limits are present", () => {
    const limits: PriceLimitResponse = {
      timestamp: "2026-03-25T09:00:00+09:00",
      upperLimitPrice: "130",
      lowerLimitPrice: "70",
      currency: "KRW",
    };
    render(<CandleChart candles={[candle()]} priceLimits={limits} />);
    expect(createPriceLine).toHaveBeenCalledTimes(2);
    const titles = createPriceLine.mock.calls.map(
      ([options]) => (options as { title: string }).title,
    );
    expect(titles).toEqual(["상한가", "하한가"]);
  });

  it("skips price lines when limits are null (e.g. US stocks)", () => {
    const limits: PriceLimitResponse = {
      timestamp: "2026-03-25T09:00:00+09:00",
      upperLimitPrice: null,
      lowerLimitPrice: null,
      currency: "USD",
    };
    render(<CandleChart candles={[candle()]} priceLimits={limits} />);
    expect(createPriceLine).not.toHaveBeenCalled();
  });

  it("maps buy/sell markers to below/above-bar arrows", () => {
    render(
      <CandleChart
        candles={[candle()]}
        markers={[
          { time: 1700000100 as never, side: "BUY" },
          { time: 1700000200 as never, side: "SELL" },
        ]}
      />,
    );
    expect(setMarkers).toHaveBeenLastCalledWith([
      { time: 1700000100, position: "belowBar", color: "#ff4d6d", shape: "arrowUp", text: "매수" },
      { time: 1700000200, position: "aboveBar", color: "#3b82f6", shape: "arrowDown", text: "매도" },
    ]);
  });

  it("removes the chart on unmount", () => {
    const { unmount } = render(<CandleChart candles={[]} />);
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
