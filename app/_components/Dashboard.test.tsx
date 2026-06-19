// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { QueryResult } from "@/lib/client/hooks";
import type {
  Account,
  CandlePageResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  OrderbookResponse,
  PaginatedOrderResponse,
  PriceLimitResponse,
  PriceResponse,
} from "@/lib/client/types";

// Dashboard composes many SWR-backed children. Mock the whole hooks module so
// the tree renders deterministic data, and `swr`'s config hook so the
// `useSWRConfig().mutate` call in the dashboard is a no-op.
const useAccounts = vi.fn<() => QueryResult<Account[]>>();
const useHoldings =
  vi.fn<(seq: number | undefined) => QueryResult<HoldingsOverview>>();
const useOrders =
  vi.fn<(seq: number | undefined) => QueryResult<PaginatedOrderResponse>>();
const useExchangeRate =
  vi.fn<() => QueryResult<ExchangeRateResponse>>();
const useCashBalances = vi.fn();

vi.mock("@/lib/client/hooks", () => ({
  useAccounts: () => useAccounts(),
  useHoldings: (seq: number | undefined) => useHoldings(seq),
  useOrders: (seq: number | undefined) => useOrders(seq),
  useExchangeRate: () => useExchangeRate(),
  useCashBalances: () => useCashBalances(),
  // Market panel hooks (used once a symbol is selected).
  usePrices: (): QueryResult<PriceResponse[]> => ({
    data: [{ symbol: "AAPL", lastPrice: "190.50", currency: "USD" }],
    error: undefined,
    isLoading: false,
  }),
  usePriceLimits: (): QueryResult<PriceLimitResponse> => ({
    data: {
      timestamp: "2026-03-25T09:00:00-04:00",
      upperLimitPrice: null,
      lowerLimitPrice: null,
      currency: "USD",
    },
    error: undefined,
    isLoading: false,
  }),
  useOrderbook: (): QueryResult<OrderbookResponse> => ({
    data: { timestamp: null, currency: "USD", asks: [], bids: [] },
    error: undefined,
    isLoading: false,
  }),
  useCandles: (): QueryResult<CandlePageResponse> => ({
    data: { candles: [], nextBefore: null },
    error: undefined,
    isLoading: false,
  }),
  ApiClientError: class extends Error {},
  submitOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock("lightweight-charts", () => ({
  createChart: () => ({
    addSeries: () => ({ setData: () => {} }),
    timeScale: () => ({ fitContent: () => {} }),
    remove: () => {},
  }),
  CandlestickSeries: "CandlestickSeries",
}));

const { Dashboard } = await import("./Dashboard");

function loaded<T>(data: T): QueryResult<T> {
  return { data, error: undefined, isLoading: false };
}

const apple = {
  symbol: "AAPL",
  name: "Apple",
  marketCountry: "US" as const,
  currency: "USD" as const,
  quantity: "5",
  lastPrice: "190.50",
  averagePurchasePrice: "210.00",
  marketValue: {
    purchaseAmount: "1050.00",
    amount: "952.50",
    amountAfterCost: "950.00",
  },
  profitLoss: {
    amount: "-97.50",
    amountAfterCost: "-100.00",
    rate: "-0.0929",
    rateAfterCost: "-0.0952",
  },
  dailyProfitLoss: { amount: "-7.50", rate: "-0.0078" },
  cost: { commission: "1.5", tax: null },
};

const overview: HoldingsOverview = {
  totalPurchaseAmount: { krw: "0", usd: "1050.00" },
  marketValue: {
    amount: { krw: "0", usd: "952.50" },
    amountAfterCost: { krw: "0", usd: "950.00" },
  },
  profitLoss: {
    amount: { krw: "0", usd: "-97.50" },
    amountAfterCost: { krw: "0", usd: "-100.00" },
    rate: "-0.0929",
    rateAfterCost: "-0.0952",
  },
  dailyProfitLoss: { amount: { krw: "0", usd: "-7.50" }, rate: "-0.0078" },
  items: [apple],
};

beforeEach(() => {
  useAccounts.mockReturnValue(
    loaded([{ accountNo: "123-45", accountSeq: 1, accountType: "위탁" }]),
  );
  useHoldings.mockReturnValue(loaded(overview));
  useOrders.mockReturnValue(loaded({ orders: [], nextCursor: null, hasNext: false }));
  useExchangeRate.mockReturnValue(
    loaded({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      rate: "1350.00",
      midRate: "1350.00",
      basisPoint: "0",
      rateChangeType: "UP",
      validFrom: "2026-03-25T09:00:00+09:00",
      validUntil: "2026-03-25T18:00:00+09:00",
    }),
  );
  useCashBalances.mockReturnValue({
    krw: "1000000",
    usd: "100",
    isLoading: false,
    error: undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dashboard", () => {
  it("prompts the user to pick a holding before a symbol is selected", () => {
    render(<Dashboard />);
    expect(screen.getByText("보유 종목을 선택하세요.")).toBeInTheDocument();
    expect(
      screen.getByText("보유 종목을 선택하면 주문할 수 있습니다."),
    ).toBeInTheDocument();
  });

  it("selecting a holding drives the market panel and order form", () => {
    render(<Dashboard />);
    // Click the holding row's name button to select it.
    fireEvent.click(screen.getByRole("button", { name: /Apple/ }));
    // Left market panel now shows the symbol header instead of the prompt.
    expect(screen.getByText("Apple (AAPL)")).toBeInTheDocument();
    expect(
      screen.queryByText("보유 종목을 선택하세요."),
    ).not.toBeInTheDocument();
    // Center order form is prefilled with the selected symbol.
    expect(screen.getByLabelText("종목코드")).toHaveValue("AAPL");
  });
});
