// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarketAdvisorInput, MarketAdvisorResult } from "@/lib/client/market-advisor";
import { MarketAiAdvisor } from "./MarketAiAdvisor";

const { fetchMarketAdvisor } = vi.hoisted(() => ({
  fetchMarketAdvisor: vi.fn(),
}));

vi.mock("@/lib/client/market-advisor", () => ({ fetchMarketAdvisor }));

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
  model: "stub-model",
  generatedAt: "2026-06-19T00:00:00Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("MarketAiAdvisor", () => {
  it("loads chart advice when the button is clicked", async () => {
    fetchMarketAdvisor.mockResolvedValue(result);
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByRole("button", { name: "조언 받기" }));

    await waitFor(() => expect(screen.getByText(/완만히 개선/)).toBeInTheDocument());
    expect(fetchMarketAdvisor).toHaveBeenCalledWith(input);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "toss-invest:market-ai-advisor-result:005930:1d",
        ) ?? "{}",
      ),
    ).toEqual(result);
  });

  it("restores stored chart advice for the same symbol and interval", () => {
    window.localStorage.setItem(
      "toss-invest:market-ai-advisor-result:005930:1d",
      JSON.stringify(result),
    );

    render(<MarketAiAdvisor input={input} />);

    expect(screen.getByText(/완만히 개선/)).toBeInTheDocument();
    expect(fetchMarketAdvisor).not.toHaveBeenCalled();
  });

  it("reruns chart advice automatically when enabled", async () => {
    vi.useFakeTimers();
    fetchMarketAdvisor.mockResolvedValue(result);
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMarketAdvisor).toHaveBeenCalledTimes(1);
  });

  it("does not restart the auto rerun timer when market input refreshes", async () => {
    vi.useFakeTimers();
    fetchMarketAdvisor.mockResolvedValue(result);
    const { rerender } = render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));
    await vi.advanceTimersByTimeAsync(30_000);
    rerender(<MarketAiAdvisor input={{ ...input, lastPrice: "73000" }} />);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMarketAdvisor).toHaveBeenCalledTimes(1);
    expect(fetchMarketAdvisor).toHaveBeenCalledWith({
      ...input,
      lastPrice: "73000",
    });
  });

  it("supports a 30 minute auto rerun interval", async () => {
    vi.useFakeTimers();
    fetchMarketAdvisor.mockResolvedValue(result);
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));
    fireEvent.change(screen.getByLabelText("자동 재실행 주기"), {
      target: { value: "1800000" },
    });
    await vi.advanceTimersByTimeAsync(1_800_000);

    expect(screen.getByRole("option", { name: "30분" })).toBeInTheDocument();
    expect(fetchMarketAdvisor).toHaveBeenCalledTimes(1);
  });
});
