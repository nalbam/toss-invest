// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Candle, Order, PriceLimitResponse } from "@/lib/client/types";

// jsdom has no canvas, so the chart library is mocked. The component is exercised
// only for mount + `series.setData(...)` / overlay wiring; real canvas rendering
// is out of scope and would otherwise throw in jsdom.
const setData = vi.fn();
const applyOptions = vi.fn();
const priceLine = { applyOptions };
const createPriceLine = vi.fn((options) => {
  void options;
  return priceLine;
});
const removePriceLine = vi.fn();
const setMarkers = vi.fn();
const detachMarkers = vi.fn();
const createSeriesMarkers = vi.fn(() => ({ setMarkers, detach: detachMarkers }));
const fitContent = vi.fn();
const priceScale = vi.fn(() => ({ applyOptions }));
const timeToCoordinate = vi.fn<(_time: unknown) => number>(() => 120);
let visibleLogicalRangeHandler: (() => void) | null = null;
const subscribeVisibleLogicalRangeChange = vi.fn((handler: () => void) => {
  visibleLogicalRangeHandler = handler;
});
const unsubscribeVisibleLogicalRangeChange = vi.fn((handler: () => void) => {
  if (visibleLogicalRangeHandler === handler) {
    visibleLogicalRangeHandler = null;
  }
});
const addSeries = vi.fn(() => ({
  setData,
  priceScale,
  createPriceLine,
  removePriceLine,
}));
const remove = vi.fn();
const createChart = vi.fn(() => ({
  addSeries,
  timeScale: () => ({
    fitContent,
    timeToCoordinate,
    subscribeVisibleLogicalRangeChange,
    unsubscribeVisibleLogicalRangeChange,
  }),
  remove,
}));

vi.mock("lightweight-charts", () => ({
  createChart,
  createSeriesMarkers,
  CandlestickSeries: "CandlestickSeries",
  HistogramSeries: "HistogramSeries",
  LineSeries: "LineSeries",
  LineStyle: { Dashed: 2 },
}));

// Imported after the mock is registered so the component picks up the stub.
const {
  CandleChart,
  formatChartPrice,
  toChartSeries,
  toVolumeSeries,
  movingAverage,
  toOrderMarkers,
} = await import("./CandleChart");

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

  it("drops candles with unparseable timestamp, volume, or OHLC", () => {
    const series = toVolumeSeries([
      candle({ timestamp: "not-a-date" }),
      candle({ timestamp: "1700000100", volume: "abc" }),
      candle({ timestamp: "1700000150", highPrice: "abc" }),
      candle({ timestamp: "1700000200" }),
    ]);
    // Only the fully-valid candle survives, matching toChartSeries' filtering.
    expect(series).toHaveLength(1);
    expect(series[0].time).toBe(1700000200);
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

describe("formatChartPrice", () => {
  it("formats chart prices with thousands separators", () => {
    expect(formatChartPrice(72000)).toBe("72,000");
    expect(formatChartPrice(1234.56)).toBe("1,234.56");
  });
});

describe("CandleChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visibleLogicalRangeHandler = null;
    timeToCoordinate.mockReturnValue(120);
  });
  afterEach(cleanup);

  it("mounts with candle, volume, and MA series and feeds converted data", () => {
    render(<CandleChart candles={[candle()]} />);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        height: 420,
        timeScale: expect.objectContaining({ rightOffset: 8 }),
      }),
    );
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
      priceFormat: {
        type: "custom",
        minMove: 0.0001,
        formatter: formatChartPrice,
      },
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

  it("draws and updates the average purchase price line", () => {
    const { rerender } = render(
      <CandleChart candles={[candle()]} averagePurchasePrice="101.5" />,
    );

    expect(createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 101.5,
        title: "평균단가",
      }),
    );

    rerender(<CandleChart candles={[candle()]} averagePurchasePrice="102" />);

    expect(applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ price: 102, title: "평균단가" }),
    );
  });

  it("draws advisor support, resistance, and candle markers", () => {
    render(
      <CandleChart
        candles={[candle()]}
        annotations={{
          supportLevels: [{ price: 99, label: "지지" }],
          resistanceLevels: [{ price: 111, label: "저항" }],
          markers: [
            {
              timestamp: "2026-03-25T09:00:00+09:00",
              position: "aboveBar",
              label: "거래량 증가 구간 확인 필요",
            },
          ],
        }}
      />,
    );

    expect(createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 99, title: "지지" }),
    );
    expect(createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 111, title: "저항" }),
    );
    expect(setMarkers).toHaveBeenCalledWith([
      expect.objectContaining({
        position: "aboveBar",
        size: 0.6,
        text: "거래량 증가 구간 …",
      }),
    ]);
  });

  it("draws cached advisor decisions as vertical overlay lines", () => {
    const { container } = render(
      <CandleChart
        candles={[candle()]}
        advisorEvents={[
          {
            symbol: "005930",
            interval: "1d",
            generatedAt: "2026-03-25T09:01:00+09:00",
            chartTimestamp: "2026-03-25T09:00:00+09:00",
            decision: {
              action: "buy",
              label: "매수 검토",
              reason: "지지선 위 반등",
            },
            advice: "반등 확인",
            cachedAt: "2026-03-25T09:01:00+09:00",
          },
        ]}
      />,
    );

    const line = container.querySelector("[title='매수 검토: 지지선 위 반등']");
    expect(line).not.toBeNull();
    expect(line).toHaveStyle({ left: "120px" });
  });

  it("repositions advisor lines when the chart visible range changes", () => {
    const { container } = render(
      <CandleChart
        candles={[candle()]}
        advisorEvents={[
          {
            symbol: "005930",
            interval: "1d",
            generatedAt: "2026-03-25T09:01:00+09:00",
            chartTimestamp: "2026-03-25T09:00:00+09:00",
            decision: {
              action: "wait",
              label: "관망",
              reason: "추세 확인",
            },
            advice: "관망",
            cachedAt: "2026-03-25T09:01:00+09:00",
          },
        ]}
      />,
    );

    const line = container.querySelector("[title='관망: 추세 확인']");
    expect(line).toHaveStyle({ left: "120px" });

    timeToCoordinate.mockReturnValue(80);
    visibleLogicalRangeHandler?.();

    expect(container.querySelector("[title='관망: 추세 확인']")).toHaveStyle({
      left: "80px",
    });
  });

  it("aligns advisor lines to the candle nearest to the advice generation time", () => {
    const newestSeconds = Math.floor(
      Date.parse("2026-06-22T10:02:00+09:00") / 1000,
    );
    timeToCoordinate.mockImplementation((time) =>
      time === newestSeconds ? 240 : 40,
    );

    const { container } = render(
      <CandleChart
        candles={[
          candle({ timestamp: "2026-06-22T10:00:00+09:00" }),
          candle({ timestamp: "2026-06-22T10:01:00+09:00" }),
          candle({ timestamp: "2026-06-22T10:02:00+09:00" }),
        ]}
        advisorEvents={[
          {
            symbol: "005930",
            interval: "1m",
            generatedAt: "2026-06-22T10:02:30+09:00",
            chartTimestamp: "2026-06-22T10:00:00+09:00",
            decision: {
              action: "wait",
              label: "관망",
              reason: "추세 확인",
            },
            advice: "관망",
            cachedAt: "2026-06-22T10:02:31+09:00",
          },
        ]}
      />,
    );

    expect(container.querySelector("[title='관망: 추세 확인']")).toHaveStyle({
      left: "240px",
    });
  });

  it("aligns daily advisor lines by the advice date in the candle timezone", () => {
    const todaySeconds = Math.floor(
      Date.parse("2026-06-22T00:00:00.000+09:00") / 1000,
    );
    timeToCoordinate.mockImplementation((time) =>
      time === todaySeconds ? 240 : 40,
    );

    const { container } = render(
      <CandleChart
        candles={[
          candle({ timestamp: "2026-06-22T00:00:00.000+09:00" }),
          candle({ timestamp: "2026-03-17T00:00:00.000+09:00" }),
        ]}
        advisorEvents={[
          {
            symbol: "0167A0",
            interval: "1d",
            generatedAt: "2026-06-22T08:25:22.505Z",
            chartTimestamp: "2026-03-17T00:00:00.000+09:00",
            decision: {
              action: "wait",
              label: "관망",
              reason: "저항권 확인",
            },
            advice: "관망",
            cachedAt: "2026-06-22T08:25:22.506Z",
          },
        ]}
      />,
    );

    expect(container.querySelector("[title='관망: 저항권 확인']")).toHaveStyle({
      left: "240px",
    });
  });

  it("does not draw advisor lines from generatedAt when chartTimestamp is missing", () => {
    const { container } = render(
      <CandleChart
        candles={[candle()]}
        advisorEvents={[
          {
            symbol: "005930",
            interval: "1d",
            generatedAt: "2026-06-22T12:00:00+09:00",
            chartTimestamp: null,
            decision: {
              action: "wait",
              label: "관망",
              reason: "장중 변동성 확인",
            },
            advice: "관망",
            cachedAt: "2026-06-22T12:00:00+09:00",
          },
        ]}
      />,
    );

    expect(container.querySelector("[title='관망: 장중 변동성 확인']")).toBeNull();
  });

  it("does not draw advisor lines outside the loaded candle range", () => {
    const { container } = render(
      <CandleChart
        candles={[candle()]}
        advisorEvents={[
          {
            symbol: "005930",
            interval: "1d",
            generatedAt: "2026-06-22T12:00:00+09:00",
            chartTimestamp: "2026-06-22T09:00:00+09:00",
            decision: {
              action: "wait",
              label: "관망",
              reason: "장중 변동성 확인",
            },
            advice: "관망",
            cachedAt: "2026-06-22T12:00:00+09:00",
          },
        ]}
      />,
    );

    expect(container.querySelector("[title='관망: 장중 변동성 확인']")).toBeNull();
  });

  it("removes the average purchase price line when the price is unavailable", () => {
    const { rerender } = render(
      <CandleChart candles={[candle()]} averagePurchasePrice="101.5" />,
    );

    rerender(<CandleChart candles={[candle()]} />);

    expect(removePriceLine).toHaveBeenCalledWith(priceLine);
  });

  it("removes the chart on unmount", () => {
    const { unmount } = render(<CandleChart candles={[]} />);
    unmount();
    expect(detachMarkers).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
