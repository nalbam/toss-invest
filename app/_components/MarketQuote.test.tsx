// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { QueryResult } from "@/lib/client/hooks";
import type {
  CandlePageResponse,
  OrderbookResponse,
  PriceLimitResponse,
  PriceResponse,
} from "@/lib/client/types";

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
    (symbol: string | undefined, interval: "1m" | "1d") => QueryResult<CandlePageResponse>
  >();

vi.mock("@/lib/client/hooks", () => ({
  usePrices: (symbols: string[]) => usePrices(symbols),
  usePriceLimits: (symbol?: string) => usePriceLimits(symbol),
  useOrderbook: (symbol?: string) => useOrderbook(symbol),
  useCandles: (symbol: string | undefined, interval: "1m" | "1d") =>
    useCandles(symbol, interval),
}));

vi.mock("lightweight-charts", () => ({
  createChart: () => ({
    addSeries: () => ({ setData: () => {} }),
    timeScale: () => ({ fitContent: () => {} }),
    remove: () => {},
  }),
  CandlestickSeries: "CandlestickSeries",
}));

const { MarketQuote } = await import("./MarketQuote");

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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MarketQuote", () => {
  it("renders the last price and KRW price limits", () => {
    render(<MarketQuote defaultSymbol="005930" />);
    expect(screen.getByText("₩72,000")).toBeInTheDocument();
    expect(screen.getByText("₩93,600")).toBeInTheDocument();
    expect(screen.getByText("₩50,400")).toBeInTheDocument();
  });

  it("renders '-' for null US price limits", () => {
    usePrices.mockReturnValue(
      loaded([{ symbol: "AAPL", lastPrice: "190.50", currency: "USD" }]),
    );
    usePriceLimits.mockReturnValue(
      loaded({
        timestamp: "2026-03-25T09:00:00-04:00",
        upperLimitPrice: null,
        lowerLimitPrice: null,
        currency: "USD",
      }),
    );
    render(<MarketQuote defaultSymbol="AAPL" />);
    expect(screen.getByText("$190.50")).toBeInTheDocument();
    // Both limits unavailable -> two "-" placeholders.
    expect(screen.getAllByText("-")).toHaveLength(2);
  });

  it("shows the loading state while the price is loading", () => {
    usePrices.mockReturnValue(loading());
    render(<MarketQuote defaultSymbol="005930" />);
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
    render(<MarketQuote defaultSymbol="005930" />);
    expect(
      screen.getByText("시세를 불러오지 못했습니다"),
    ).toBeInTheDocument();
  });
});
