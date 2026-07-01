// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { QueryResult } from "@/lib/client/hooks";
import type {
  Candle,
  CandlePageResponse,
  OrderbookResponse,
  PriceLimitResponse,
  PriceResponse,
  Trade,
} from "@/lib/client/types";
import type { ChartInterval, TossCandleInterval } from "@/lib/client/candles";
import {
  __resetSettingsStore,
  __seedSettings,
  getStoredItem,
} from "./settingsStore";

// The SWR hooks hit `/api/*`; mock them so the component renders deterministic
// states without a network. `lightweight-charts` is mocked because the rendered
// CandleChart would otherwise touch a canvas jsdom does not implement.
const usePrices = vi.fn<(symbols: string[]) => QueryResult<PriceResponse[]>>();
const usePriceLimits =
  vi.fn<(symbol?: string) => QueryResult<PriceLimitResponse>>();
const useOrderbook =
  vi.fn<(symbol?: string) => QueryResult<OrderbookResponse>>();
const useCandles =
  vi.fn<
    (symbol: string | undefined, interval: TossCandleInterval) => QueryResult<CandlePageResponse>
  >();
const useTrades = vi.fn<(symbol?: string) => QueryResult<Trade[]>>();
const useMarketAdvisorHistory =
  vi.fn<(symbol: string | undefined, interval: string) => QueryResult<{ events: [] }>>();
const fetchOlderCandles =
  vi.fn<
    (
      symbol: string,
      interval: TossCandleInterval,
      before: string,
      count?: number,
    ) => Promise<CandlePageResponse>
  >();
const collectSourceCandles =
  vi.fn<(symbol: string, interval: ChartInterval) => Promise<Candle[]>>();

vi.mock("@/lib/client/hooks", () => ({
  usePrices: (symbols: string[]) => usePrices(symbols),
  usePriceLimits: (symbol?: string) => usePriceLimits(symbol),
  useOrderbook: (symbol?: string) => useOrderbook(symbol),
  useCandles: (symbol: string | undefined, interval: TossCandleInterval) =>
    useCandles(symbol, interval),
  useTrades: (symbol?: string) => useTrades(symbol),
  useMarketAdvisorHistory: (symbol: string | undefined, interval: string) =>
    useMarketAdvisorHistory(symbol, interval),
  fetchOlderCandles: (
    symbol: string,
    interval: TossCandleInterval,
    before: string,
    count?: number,
  ) => fetchOlderCandles(symbol, interval, before, count),
}));

// Only the chart backfill is stubbed; the rest of market-advisor (used by the
// rendered MarketAiAdvisor) stays real so its behavior is unaffected.
vi.mock("@/lib/client/market-advisor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/client/market-advisor")>();
  return {
    ...actual,
    collectSourceCandles: (symbol: string, interval: ChartInterval) =>
      collectSourceCandles(symbol, interval),
  };
});

// Capture the chart's visible-range subscribers so a test can simulate the user
// scrolling to the oldest edge (which drives auto-loading of older candles).
const { chartRangeHandlers } = vi.hoisted(() => ({
  chartRangeHandlers: [] as Array<(range?: unknown) => void>,
}));
function fireChartVisibleRange(range?: unknown) {
  for (const handler of [...chartRangeHandlers]) {
    handler(range);
  }
}

vi.mock("lightweight-charts", () => ({
  createChart: () => ({
    addSeries: () => ({
      setData: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({ applyOptions: () => {} }),
      removePriceLine: () => {},
    }),
    priceScale: () => ({ width: () => 0 }),
    timeScale: () => ({
      fitContent: () => {},
      timeToCoordinate: () => 120,
      options: () => ({ barSpacing: 6 }),
      subscribeVisibleLogicalRangeChange: (handler: (range?: unknown) => void) => {
        chartRangeHandlers.push(handler);
      },
      unsubscribeVisibleLogicalRangeChange: (handler: (range?: unknown) => void) => {
        const index = chartRangeHandlers.indexOf(handler);
        if (index >= 0) {
          chartRangeHandlers.splice(index, 1);
        }
      },
    }),
    remove: () => {},
  }),
  createSeriesMarkers: () => ({
    setMarkers: () => {},
    detach: () => {},
  }),
  CandlestickSeries: "CandlestickSeries",
  HistogramSeries: "HistogramSeries",
  LineSeries: "LineSeries",
  LineStyle: { Dashed: 2 },
}));

type FavHook = {
  items: Array<{
    id: number;
    symbol: string;
    name: string | null;
    currency: string | null;
  }>;
  mutate: () => void;
  isLoading: boolean;
};

const { useFavorites, addFavoriteItem, removeFavoriteItem } = vi.hoisted(() => ({
  useFavorites: vi.fn(
    (): FavHook => ({ items: [], mutate: vi.fn(), isLoading: false }),
  ),
  addFavoriteItem: vi.fn(() => Promise.resolve({})),
  removeFavoriteItem: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/lib/client/favorites", () => ({
  useFavorites,
  addFavoriteItem,
  removeFavoriteItem,
}));

const { MarketQuote, __clearBackfillCache } = await import("./MarketQuote");

/**
 * Matcher for a money amount whose currency symbol is split into its own span by
 * <Money>. Matching on the element's full textContent reassembles the symbol +
 * digits so the expected string stays the same as the rendered amount.
 */
const byMoney =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

function loaded<T>(data: T): QueryResult<T> {
  return { data, error: undefined, isLoading: false };
}

function loading<T>(): QueryResult<T> {
  return { data: undefined, error: undefined, isLoading: true };
}

function manyCandles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
    openPrice: "100",
    highPrice: "110",
    lowPrice: "90",
    closePrice: "105",
    volume: "10",
    currency: "KRW",
  }));
}

beforeEach(() => {
  // Sensible defaults; individual tests override as needed.
  usePrices.mockReturnValue(
    loaded([{ symbol: "005930", lastPrice: "72000", currency: "KRW" }]),
  );
  usePriceLimits.mockReturnValue(
    loaded({
      timestamp: "2026-03-25T09:00:00+09:00",
      upperLimitPrice: "93600",
      lowerLimitPrice: "50400",
      currency: "KRW",
    }),
  );
  useOrderbook.mockReturnValue(
    loaded({ timestamp: null, currency: "KRW", asks: [], bids: [] }),
  );
  useCandles.mockReturnValue(loaded({ candles: [], nextBefore: null }));
  fetchOlderCandles.mockResolvedValue({ candles: [], nextBefore: null });
  useTrades.mockReturnValue(loaded([]));
  useMarketAdvisorHistory.mockReturnValue(loaded({ events: [] }));
  useFavorites.mockReturnValue({ items: [], mutate: vi.fn(), isLoading: false });
  collectSourceCandles.mockResolvedValue([]);
  chartRangeHandlers.length = 0;
});

afterEach(() => {
  cleanup();
  document.title = "";
  __resetSettingsStore();
  // The backfill cache is module-level; clear it so it never leaks between tests.
  __clearBackfillCache();
  vi.clearAllMocks();
});

describe("MarketQuote", () => {
  it("renders the last price", () => {
    render(<MarketQuote symbol="005930" />);
    expect(screen.getByText(byMoney("₩72,000"))).toBeInTheDocument();
  });

  it("backfills an interval-sized source window on mount", async () => {
    render(<MarketQuote symbol="005930" />);
    // Default stored interval is 1d; backfill collects its source window so
    // larger intervals fill the screen rather than the single live page.
    await waitFor(() =>
      expect(collectSourceCandles).toHaveBeenCalledWith("005930", "1d"),
    );
  });

  it("restores a previously backfilled symbol from cache without refetching", async () => {
    // A's backfill completes (fills the 1d target of 200) and gets cached.
    collectSourceCandles.mockResolvedValueOnce(manyCandles(200));
    // B's backfill never resolves — the user leaves before it lands.
    collectSourceCandles.mockReturnValueOnce(new Promise<Candle[]>(() => {}));

    const { rerender } = render(<MarketQuote symbol="005930" />);
    await waitFor(() =>
      expect(collectSourceCandles).toHaveBeenCalledWith("005930", "1d"),
    );
    // Wait for A's chart to render (backfill settled) so its window is cached.
    await screen.findByLabelText("캔들 차트");

    rerender(<MarketQuote symbol="000660" />);
    await waitFor(() =>
      expect(collectSourceCandles).toHaveBeenCalledWith("000660", "1d"),
    );

    collectSourceCandles.mockClear();
    rerender(<MarketQuote symbol="005930" />);
    // Returning to A restores its cached window immediately: the chart shows the
    // full window in one pass (no transient few-bar view, the reported 8-bar
    // bug) and A is not re-backfilled.
    expect(await screen.findByLabelText("캔들 차트")).toBeInTheDocument();
    expect(collectSourceCandles).not.toHaveBeenCalled();
  });

  it("holds the loader until backfill settles, then shows the full chart", async () => {
    let resolveBackfill: (candles: Candle[]) => void = () => {};
    // First-entry backfill stays in flight until the test resolves it.
    collectSourceCandles.mockReturnValueOnce(
      new Promise<Candle[]>((resolve) => {
        resolveBackfill = resolve;
      }),
    );
    // The live page alone aggregates to only a handful of bars — what we must
    // never flash. Keep the chart behind the loader until backfill lands.
    useCandles.mockReturnValue(
      loaded({ candles: manyCandles(7), nextBefore: null }),
    );

    render(<MarketQuote symbol="005930" />);

    expect(screen.getByText("차트를 불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByLabelText("캔들 차트")).not.toBeInTheDocument();

    resolveBackfill(manyCandles(200));
    expect(await screen.findByLabelText("캔들 차트")).toBeInTheDocument();
  });

  it("adds the current symbol to favorites via the star", async () => {
    render(<MarketQuote symbol="005930" name="삼성전자" />);
    fireEvent.click(screen.getByLabelText("즐겨찾기 추가"));
    await waitFor(() =>
      expect(addFavoriteItem).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: "005930", name: "삼성전자" }),
      ),
    );
  });

  it("removes the symbol when it is already a favorite", async () => {
    useFavorites.mockReturnValue({
      items: [{ id: 1, symbol: "005930", name: "삼성전자", currency: "KRW" }],
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<MarketQuote symbol="005930" name="삼성전자" />);
    fireEvent.click(screen.getByLabelText("즐겨찾기 해제"));
    await waitFor(() =>
      expect(removeFavoriteItem).toHaveBeenCalledWith("005930"),
    );
  });

  it("shows the day change in the header vs the previous daily close", () => {
    usePrices.mockReturnValue(
      loaded([{ symbol: "005930", lastPrice: "72000", currency: "KRW" }]),
    );
    const bar = (timestamp: string, closePrice: string) => ({
      timestamp,
      openPrice: "0",
      highPrice: "0",
      lowPrice: "0",
      closePrice,
      volume: "0",
      currency: "KRW" as const,
    });
    useCandles.mockReturnValue(
      loaded({
        candles: [
          bar("2026-06-18T00:00:00+09:00", "70000"), // previous close
          bar("2026-06-19T00:00:00+09:00", "71000"), // latest bar
        ],
        nextBefore: null,
      }),
    );
    render(<MarketQuote symbol="005930" />);
    // 72,000 - 70,000 = +2,000 ; 2000/70000 = +2.86%
    expect(
      screen.getByText(
        (_, el) => el?.textContent?.replace(/\s/g, "") === "₩2,000(+2.86%)",
      ),
    ).toBeInTheDocument();
  });

  it("updates the browser title with price, change rate, and name", async () => {
    const bar = (timestamp: string, closePrice: string) => ({
      timestamp,
      openPrice: "0",
      highPrice: "0",
      lowPrice: "0",
      closePrice,
      volume: "0",
      currency: "KRW" as const,
    });
    useCandles.mockReturnValue(
      loaded({
        candles: [
          bar("2026-06-18T00:00:00+09:00", "70000"),
          bar("2026-06-19T00:00:00+09:00", "71000"),
        ],
        nextBefore: null,
      }),
    );

    render(<MarketQuote symbol="005930" name="삼성전자" />);

    await waitFor(() => {
      expect(document.title).toBe("₩72,000 +2.86% 삼성전자");
    });
  });

  it("shows the holding name in the header when provided", () => {
    render(
      <MarketQuote
        symbol="005930"
        name="삼성전자"
        averagePurchasePrice="65000"
      />,
    );
    expect(screen.getByText("삼성전자 (005930)")).toBeInTheDocument();
  });

  it("offers minute granularities via a select and day intervals as buttons", () => {
    render(<MarketQuote symbol="005930" />);
    // Day-and-longer intervals stay buttons.
    expect(screen.getByRole("button", { name: "일" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "년" })).toBeInTheDocument();
    // No "분" button anymore — minute granularity is a select with 1~240분.
    expect(screen.queryByRole("button", { name: "분" })).not.toBeInTheDocument();

    const minuteSelect = screen.getByLabelText("분봉 단위");
    fireEvent.change(minuteSelect, { target: { value: "5m" } });

    // 5분 still sources Toss 1m candles (aggregated client-side) and is persisted.
    expect(useCandles).toHaveBeenCalledWith("005930", "1m");
    expect((minuteSelect as HTMLSelectElement).value).toBe("5m");
    expect(getStoredItem("toss-invest:chart-interval")).toBe("5m");
  });

  it("restores the stored chart interval and marks it selected", async () => {
    __seedSettings({ "toss-invest:chart-interval": "1w" });

    render(<MarketQuote symbol="005930" />);

    const weekly = screen.getByRole("button", { name: "주" });
    await waitFor(() => {
      expect(weekly).toHaveAttribute("aria-pressed", "true");
    });
    expect(useCandles).toHaveBeenCalledWith("005930", "1d");
  });

  it("reads the stored minute interval at mount and requests its source candles immediately", async () => {
    __seedSettings({ "toss-invest:chart-interval": "1m" });

    render(<MarketQuote symbol="005930" />);

    await waitFor(() => {
      expect(
        (screen.getByLabelText("분봉 단위") as HTMLSelectElement).value,
      ).toBe("1m");
    });
    // The stored interval is read synchronously at mount, so the chart requests
    // its source candles straight away without a deferred "1d" fetch first.
    expect(useCandles).not.toHaveBeenCalledWith(undefined, "1d");
    expect(useCandles).toHaveBeenCalledWith("005930", "1m");
  });

  it("renders the USD last price", () => {
    usePrices.mockReturnValue(
      loaded([{ symbol: "AAPL", lastPrice: "190.50", currency: "USD" }]),
    );
    render(<MarketQuote symbol="AAPL" />);
    expect(screen.getByText(byMoney("$190.50"))).toBeInTheDocument();
  });

  it("shows the loading state while the price is loading", () => {
    usePrices.mockReturnValue(loading());
    render(<MarketQuote symbol="005930" />);
    expect(screen.getAllByText("불러오는 중…").length).toBeGreaterThan(0);
  });

  it("shows the error message when the price request fails", () => {
    usePrices.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new (class extends Error {
        code = "upstream-error";
        status = 502;
      })("시세를 불러오지 못했습니다") as never,
    });
    render(<MarketQuote symbol="005930" />);
    expect(
      screen.getByText("시세를 불러오지 못했습니다"),
    ).toBeInTheDocument();
  });

  it("auto-loads older candles when the chart scrolls to the oldest edge", async () => {
    const c = {
      timestamp: "2026-06-18T05:00:00Z",
      openPrice: "100",
      highPrice: "110",
      lowPrice: "90",
      closePrice: "105",
      volume: "10",
      currency: "KRW" as const,
    };
    useCandles.mockReturnValue(
      loaded({ candles: [c], nextBefore: "2026-06-18T05:00:00Z" }),
    );
    fetchOlderCandles.mockResolvedValue({
      candles: [{ ...c, timestamp: "2026-06-18T04:00:00Z" }],
      nextBefore: null,
    });

    render(<MarketQuote symbol="005930" />);

    // The chart appears only once backfill settles (here an empty result).
    await screen.findByLabelText("캔들 차트");

    // Far from the oldest edge → no fetch.
    fireChartVisibleRange({ from: 50, to: 100 });
    expect(fetchOlderCandles).not.toHaveBeenCalled();

    // Scrolled near the oldest bar → auto-fetch older candles before the oldest
    // shown timestamp, at the source interval (no button involved).
    fireChartVisibleRange({ from: 1, to: 40 });
    await waitFor(() => {
      expect(fetchOlderCandles).toHaveBeenCalledWith(
        "005930",
        "1d",
        "2026-06-18T05:00:00Z",
        undefined,
      );
    });
  });
});
