// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarketAdvisorInput, MarketAdvisorHistoryEvent } from "@/lib/client/market-advisor";
import type { WatchlistItem } from "@/lib/client/watchlist";
import { MarketAiAdvisor } from "./MarketAiAdvisor";

type WatchlistHook = {
  items: WatchlistItem[];
  mutate: () => void;
  isLoading: boolean;
};

type HistoryHook = {
  data?: { events: MarketAdvisorHistoryEvent[] };
  error?: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
};

const { fetchMarketAdvisor } = vi.hoisted(() => ({
  fetchMarketAdvisor: vi.fn(),
}));
vi.mock("@/lib/client/market-advisor", () => ({ fetchMarketAdvisor }));

const { useMarketAdvisorHistory, marketAdvisorHistoryKey, ApiClientError } = vi.hoisted(
  () => ({
    useMarketAdvisorHistory: vi.fn(
      (): HistoryHook => ({ data: { events: [] }, isLoading: false, isRefreshing: false }),
    ),
    marketAdvisorHistoryKey: vi.fn(
      (symbol: string, interval: string) =>
        `/api/market-advisor/history?symbol=${symbol}&interval=${interval}`,
    ),
    ApiClientError: class ApiClientError extends Error {
      code?: string;
    },
  }),
);
vi.mock("@/lib/client/hooks", () => ({
  useMarketAdvisorHistory,
  marketAdvisorHistoryKey,
  ApiClientError,
}));

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn(() => Promise.resolve()) }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate }) }));

const {
  useWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  setWatchlistItemRunEvery,
} = vi.hoisted(() => ({
  useWatchlist: vi.fn((): WatchlistHook => ({ items: [], mutate: vi.fn(), isLoading: false })),
  addWatchlistItem: vi.fn(() => Promise.resolve({})),
  removeWatchlistItem: vi.fn(() => Promise.resolve({})),
  setWatchlistItemRunEvery: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/lib/client/watchlist", () => ({
  useWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  setWatchlistItemRunEvery,
}));

const input: MarketAdvisorInput = {
  symbol: "005930",
  name: "삼성전자",
  interval: "1d",
  currency: "KRW",
  lastPrice: "72000",
  candles: [],
};

const event: MarketAdvisorHistoryEvent = {
  symbol: "005930",
  interval: "1d",
  generatedAt: "2026-06-19T12:00:00Z",
  chartTimestamp: "2026-06-19T12:00:00Z",
  lastPrice: "72000",
  decision: {
    action: "buy",
    label: "매수 검토",
    reason: "지지선 위에서 반등 흐름이 확인됩니다.",
  },
  advice: "단기 추세가 완만히 개선되고 있습니다.",
  annotations: {
    supportLevels: [{ price: 68000, label: "지지 가능 구간" }],
    resistanceLevels: [{ price: 72000, label: "저항 확인 구간" }],
    markers: [],
  },
  cachedAt: "2026-06-19T12:00:00Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  useWatchlist.mockReturnValue({ items: [], mutate: vi.fn(), isLoading: false });
  useMarketAdvisorHistory.mockReturnValue({
    data: { events: [] },
    isLoading: false,
    isRefreshing: false,
  });
});

describe("MarketAiAdvisor", () => {
  it("displays the latest persisted advice from history with its timestamp", () => {
    useMarketAdvisorHistory.mockReturnValue({
      data: { events: [event] },
      isLoading: false,
      isRefreshing: false,
    });
    render(<MarketAiAdvisor input={input} />);

    expect(screen.getByText("매수 검토")).toBeInTheDocument();
    expect(screen.getByText(/완만히 개선/)).toBeInTheDocument();
    expect(screen.getByText(/조언 일시: 2026-06-19/)).toBeInTheDocument();
  });

  it("does not read advice from localStorage", () => {
    window.localStorage.setItem(
      "toss-invest:market-ai-advisor-result:005930:1d",
      JSON.stringify({ advice: "캐시된 조언" }),
    );
    render(<MarketAiAdvisor input={input} />);

    expect(screen.queryByText(/캐시된 조언/)).not.toBeInTheDocument();
  });

  it("runs a manual analysis and revalidates the history on button click", async () => {
    fetchMarketAdvisor.mockResolvedValue(undefined);
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByRole("button", { name: "조언 받기" }));

    await waitFor(() => expect(fetchMarketAdvisor).toHaveBeenCalledWith(input));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        "/api/market-advisor/history?symbol=005930&interval=1d",
      ),
    );
  });

  it("registers the current symbol/chart when auto-analyze is toggled on", async () => {
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));

    await waitFor(() =>
      expect(addWatchlistItem).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: "005930", interval: "1d", currency: "KRW" }),
      ),
    );
  });

  it("removes the watchlist entry when auto-analyze is toggled off", async () => {
    useWatchlist.mockReturnValue({
      items: [
        {
          id: 7,
          symbol: "005930",
          name: "삼성전자",
          interval: "1d",
          currency: "KRW",
          enabled: true,
          runEveryMinutes: 60,
          lastRunAt: null,
          lastChartTimestamp: null,
        },
      ],
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));

    await waitFor(() => expect(removeWatchlistItem).toHaveBeenCalledWith(7));
  });
});
