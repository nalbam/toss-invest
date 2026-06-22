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
  annotations: {
    supportLevels: [{ price: 68000, label: "지지 가능 구간" }],
    resistanceLevels: [{ price: 72000, label: "저항 확인 구간" }],
    markers: [
      {
        timestamp: "2026-06-19T00:00:00+09:00",
        position: "aboveBar",
        label: "거래량 증가",
      },
    ],
  },
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
    const onResult = vi.fn();
    render(<MarketAiAdvisor input={input} onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: "조언 받기" }));

    await waitFor(() => expect(screen.getByText(/완만히 개선/)).toBeInTheDocument());
    expect(fetchMarketAdvisor).toHaveBeenCalledWith(input);
    expect(onResult).toHaveBeenLastCalledWith(result);
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

    const onResult = vi.fn();
    render(<MarketAiAdvisor input={input} onResult={onResult} />);

    expect(screen.getByText(/완만히 개선/)).toBeInTheDocument();
    expect(onResult).toHaveBeenLastCalledWith(result);
    expect(fetchMarketAdvisor).not.toHaveBeenCalled();
  });

  it("reruns chart advice automatically when enabled", async () => {
    vi.useFakeTimers();
    fetchMarketAdvisor.mockResolvedValue(result);
    render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));
    await vi.advanceTimersByTimeAsync(600_000);

    expect(fetchMarketAdvisor).toHaveBeenCalledTimes(1);
  });

  it("does not restart the auto rerun timer when market input refreshes", async () => {
    vi.useFakeTimers();
    fetchMarketAdvisor.mockResolvedValue(result);
    const { rerender } = render(<MarketAiAdvisor input={input} />);

    fireEvent.click(screen.getByLabelText("자동 재실행 활성화"));
    expect(screen.getByLabelText("자동 재실행 활성화")).toHaveStyle({
      "--advisor-progress-deg": "360deg",
    });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(screen.getByLabelText("자동 재실행 활성화")).toHaveStyle({
      "--advisor-progress-deg": "180deg",
    });
    rerender(<MarketAiAdvisor input={{ ...input, lastPrice: "73000" }} />);
    await vi.advanceTimersByTimeAsync(300_000);

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
    expect(screen.queryByRole("option", { name: "1분" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("자동 재실행 활성화")).toHaveStyle({
      "--advisor-spin-duration": "6s",
    });
    expect(fetchMarketAdvisor).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        window.localStorage.getItem("toss-invest:market-ai-advisor-auto") ??
          "{}",
      ),
    ).toEqual({ enabled: true, intervalMs: 1_800_000 });
  });

  it("restores stored auto rerun settings", async () => {
    window.localStorage.setItem(
      "toss-invest:market-ai-advisor-auto",
      JSON.stringify({ enabled: true, intervalMs: 1_800_000 }),
    );

    render(<MarketAiAdvisor input={input} />);

    await waitFor(() =>
      expect(screen.getByLabelText("자동 재실행 활성화")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByLabelText("자동 재실행 주기")).toHaveValue("1800000");
  });
});
