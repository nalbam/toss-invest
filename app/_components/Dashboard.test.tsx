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
  Account,
  CandlePageResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  OrderbookResponse,
  PaginatedOrderResponse,
  PriceLimitResponse,
  PriceResponse,
  SellableQuantity,
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
const fetchAdvisor = vi.fn();

// The AI advisor card triggers a paid LLM fetch; stub it so a proposal can be
// applied deterministically.
vi.mock("@/lib/client/advisor", () => ({
  fetchAdvisor: () => fetchAdvisor(),
}));

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
  useSellableQuantity: (): QueryResult<SellableQuantity> => ({
    data: { sellableQuantity: "5" },
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
  useMarketAdvisorHistory: () => ({
    data: { events: [] },
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
    addSeries: () => ({
      setData: () => {},
      createPriceLine: () => ({ applyOptions: () => {} }),
      removePriceLine: () => {},
    }),
    timeScale: () => ({
      fitContent: () => {},
      timeToCoordinate: () => 120,
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    }),
    remove: () => {},
  }),
  createSeriesMarkers: () => ({
    setMarkers: () => {},
    detach: () => {},
  }),
  LineStyle: { Dashed: 2 },
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

const samsung = {
  ...apple,
  symbol: "005930",
  name: "삼성전자",
  marketCountry: "KR" as const,
  currency: "KRW" as const,
  lastPrice: "72000",
  averagePurchasePrice: "65000",
  marketValue: {
    purchaseAmount: "650000",
    amount: "720000",
    amountAfterCost: "719000",
  },
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

const samsungOverview: HoldingsOverview = {
  ...overview,
  items: [samsung],
};

beforeEach(() => {
  useAccounts.mockReturnValue(
    loaded([
      { accountNo: "11001044791", accountSeq: 1, accountType: "BROKERAGE" },
    ]),
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
  document.title = "";
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("Dashboard", () => {
  it("masks account numbers in the account selector", () => {
    const { container } = render(<Dashboard />);

    expect(screen.getByRole("group", { name: "테마" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "110*****791 (BROKERAGE)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("11001044791 (BROKERAGE)"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-private-value='true']"),
    ).not.toBeNull();
  });

  it("toggles privacy blur with Ctrl or Command + Shift + B", () => {
    const { container } = render(<Dashboard />);
    const root = container.firstElementChild;

    expect(root).toHaveAttribute("data-privacy-blurred", "false");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true, shiftKey: true });
    expect(root).toHaveAttribute("data-privacy-blurred", "true");

    fireEvent.keyDown(window, { key: "B", metaKey: true, shiftKey: true });
    expect(root).toHaveAttribute("data-privacy-blurred", "false");
  });

  it("prompts the user to pick a holding before a symbol is selected", () => {
    render(<Dashboard />);
    expect(screen.getByText("보유 종목을 선택하세요.")).toBeInTheDocument();
    expect(
      screen.getByText("보유 종목을 선택하면 주문할 수 있습니다."),
    ).toBeInTheDocument();
    expect(document.title).toBe("토스증권 대시보드");
  });

  it("selecting a holding drives the market panel and order form", () => {
    render(<Dashboard />);
    // Click the holding row to select it.
    fireEvent.click(screen.getByText("Apple").closest("button")!);
    // Left market panel now shows the symbol header instead of the prompt.
    expect(screen.getByText("Apple (AAPL)")).toBeInTheDocument();
    expect(
      screen.queryByText("보유 종목을 선택하세요."),
    ).not.toBeInTheDocument();
    // Center order form (defaults to 빠른주문) follows the selected symbol; the
    // 일반주문 tab exposes the prefilled 종목코드 field.
    fireEvent.click(screen.getByRole("tab", { name: "일반주문" }));
    expect(screen.getByLabelText("종목코드")).toHaveValue("AAPL");
    expect(window.localStorage.getItem("toss-invest:last-symbol")).toBe("AAPL");
    expect(window.localStorage.getItem("toss-invest:last-symbol:1")).toBe(
      "AAPL",
    );
  });

  it("applying a non-held BUY proposal switches the symbol and labels it with the resolved name", async () => {
    fetchAdvisor.mockResolvedValue({
      advice: "신규 매수 검토",
      model: "stub-model",
      generatedAt: "2026-06-22T00:00:00.000Z",
      proposals: [
        {
          proposal: {
            kind: "buy",
            symbol: "360750",
            side: "BUY",
            quantity: 10,
            rationale: "지수 분산",
          },
          valid: true,
          reasons: [],
          name: "TIGER 미국S&P500",
        },
      ],
    });

    render(<Dashboard />);
    // Start from an already-selected holding (the user's real scenario).
    fireEvent.click(screen.getByText("Apple").closest("button")!);
    expect(screen.getByText("Apple (AAPL)")).toBeInTheDocument();

    // Once a symbol is selected the market panel also shows the chart advisor's
    // "조언 받기"; the portfolio advisor (right sidebar) is the last one in DOM.
    const runButtons = screen.getAllByRole("button", { name: "조언 받기" });
    fireEvent.click(runButtons[runButtons.length - 1]);
    fireEvent.click(await screen.findByText("폼에 담기"));

    // Left market panel header should switch to the proposed symbol AND show its
    // resolved name (not just the code) — same as selecting a holding.
    expect(screen.getByText("TIGER 미국S&P500 (360750)")).toBeInTheDocument();
    expect(screen.queryByText("Apple (AAPL)")).not.toBeInTheDocument();
    // Center order form 종목코드 follows the proposed symbol; 일반주문 tab shows it.
    fireEvent.click(screen.getByRole("tab", { name: "일반주문" }));
    expect(screen.getByLabelText("종목코드")).toHaveValue("360750");
  });

  it("restores the last selected holding when it is still present", async () => {
    window.localStorage.setItem("toss-invest:last-symbol:1", "AAPL");

    render(<Dashboard />);

    expect(await screen.findByText("Apple (AAPL)")).toBeInTheDocument();
  });

  it("restores the selected account when it is still available", async () => {
    window.localStorage.setItem("toss-invest:selected-account-seq", "2");
    useAccounts.mockReturnValue(
      loaded([
        { accountNo: "11001044791", accountSeq: 1, accountType: "BROKERAGE" },
        { accountNo: "22001044792", accountSeq: 2, accountType: "BROKERAGE" },
      ]),
    );
    useHoldings.mockImplementation((seq) =>
      loaded(seq === 2 ? samsungOverview : overview),
    );

    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByLabelText("계좌")).toHaveValue("2"),
    );
  });

  it("stores account changes and resets the selected symbol", async () => {
    useAccounts.mockReturnValue(
      loaded([
        { accountNo: "11001044791", accountSeq: 1, accountType: "BROKERAGE" },
        { accountNo: "22001044792", accountSeq: 2, accountType: "BROKERAGE" },
      ]),
    );
    useHoldings.mockImplementation((seq) =>
      loaded(seq === 2 ? samsungOverview : overview),
    );

    render(<Dashboard />);
    fireEvent.click(screen.getByText("Apple").closest("button")!);
    expect(await screen.findByText("Apple (AAPL)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("계좌"), { target: { value: "2" } });

    expect(window.localStorage.getItem("toss-invest:selected-account-seq")).toBe(
      "2",
    );
    expect(screen.getByText("보유 종목을 선택하세요.")).toBeInTheDocument();
  });
});
