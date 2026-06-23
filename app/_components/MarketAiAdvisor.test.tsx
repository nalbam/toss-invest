// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarketAdvisorInput, MarketAdvisorResult } from "@/lib/client/market-advisor";
import type { WatchlistItem } from "@/lib/client/watchlist";
import { MarketAiAdvisor } from "./MarketAiAdvisor";

type WatchlistHook = {
  items: WatchlistItem[];
  mutate: () => void;
  isLoading: boolean;
};

const { fetchMarketAdvisor } = vi.hoisted(() => ({
  fetchMarketAdvisor: vi.fn(),
}));
vi.mock("@/lib/client/market-advisor", () => ({ fetchMarketAdvisor }));

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

const result: MarketAdvisorResult = {
  advice: "단기 추세가 완만히 개선되고 있습니다.",
  decision: {
    action: "buy",
    label: "매수 검토",
    reason: "지지선 위에서 반등 흐름이 확인됩니다.",
  },
  annotations: {
    supportLevels: [{ price: 68000, label: "지지 가능 구간" }],
    resistanceLevels: [{ price: 72000, label: "저항 확인 구간" }],
    markers: [],
  },
  model: "stub-model",
  generatedAt: "2026-06-19T00:00:00Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  useWatchlist.mockReturnValue({ items: [], mutate: vi.fn(), isLoading: false });
});

describe("MarketAiAdvisor", () => {
  it("loads chart advice when the button is clicked", async () => {
    fetchMarketAdvisor.mockResolvedValue(result);
    const onResult = vi.fn();
    render(<MarketAiAdvisor input={input} onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: "조언 받기" }));

    await waitFor(() => expect(screen.getByText(/완만히 개선/)).toBeInTheDocument());
    expect(screen.getByText("매수 검토")).toBeInTheDocument();
    expect(fetchMarketAdvisor).toHaveBeenCalledWith(input);
    expect(onResult).toHaveBeenLastCalledWith(result);
  });

  it("restores stored chart advice for the same symbol and interval", () => {
    window.localStorage.setItem(
      "toss-invest:market-ai-advisor-result:005930:1d",
      JSON.stringify(result),
    );
    const onResult = vi.fn();
    render(<MarketAiAdvisor input={input} onResult={onResult} />);

    expect(screen.getByText(/완만히 개선/)).toBeInTheDocument();
    expect(onResult).toHaveBeenLastCalledWith(result);
    expect(fetchMarketAdvisor).not.toHaveBeenCalled();
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
