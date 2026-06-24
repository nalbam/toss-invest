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
  CandlePageResponse,
  OrderbookResponse,
  PriceLimitResponse,
  PriceResponse,
  Trade,
} from "@/lib/client/types";
import type { TossCandleInterval } from "@/lib/client/candles";

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

vi.mock("@/lib/client/hooks", () => ({
  usePrices: (symbols: string[]) => usePrices(symbols),
  usePriceLimits: (symbol?: string) => usePriceLimits(symbol),
  useOrderbook: (symbol?: string) => useOrderbook(symbol),
  useCandles: (symbol: string | undefined, interval: TossCandleInterval) =>
    useCandles(symbol, interval),
  useTrades: (symbol?: string) => useTrades(symbol),
  useMarketAdvisorHistory: (symbol: string | undefined, interval: string) =>
    useMarketAdvisorHistory(symbol, interval),
}));

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
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
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

const { MarketQuote } = await import("./MarketQuote");

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
  useTrades.mockReturnValue(loaded([]));
  useMarketAdvisorHistory.mockReturnValue(loaded({ events: [] }));
});

afterEach(() => {
  cleanup();
  document.title = "";
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("MarketQuote", () => {
  it("renders the last price", () => {
    render(<MarketQuote symbol="005930" />);
    expect(screen.getByText(byMoney("₩72,000"))).toBeInTheDocument();
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

  it("renders chart interval buttons and marks the selected interval", () => {
    render(<MarketQuote symbol="005930" />);
    expect(screen.getByRole("button", { name: "분" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "년" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "분" }));

    expect(screen.getByRole("button", { name: "분" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(useCandles).toHaveBeenCalledWith("005930", "1m");
    expect(window.localStorage.getItem("toss-invest:chart-interval")).toBe(
      "1m",
    );
  });

  it("restores the stored chart interval and marks it selected", async () => {
    window.localStorage.setItem("toss-invest:chart-interval", "1w");

    render(<MarketQuote symbol="005930" />);

    const weekly = screen.getByRole("button", { name: "주" });
    await waitFor(() => {
      expect(weekly).toHaveAttribute("aria-pressed", "true");
    });
    expect(useCandles).toHaveBeenCalledWith("005930", "1d");
  });

  it("waits for the stored minute interval before requesting chart candles", async () => {
    window.localStorage.setItem("toss-invest:chart-interval", "1m");

    render(<MarketQuote symbol="005930" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "분" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(useCandles).toHaveBeenCalledWith(undefined, "1d");
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
});
