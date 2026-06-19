// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/hooks";
import type { AdvisorResult } from "@/lib/client/advisor";
import { AiAdvisor } from "./AiAdvisor";

const { fetchAdvisor } = vi.hoisted(() => ({ fetchAdvisor: vi.fn() }));
vi.mock("@/lib/client/advisor", () => ({ fetchAdvisor }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const result: AdvisorResult = {
  advice: "삼성전자 비중이 높습니다. 분산을 고려하세요.",
  proposals: [
    {
      proposal: { kind: "trim", symbol: "005930", side: "SELL", quantity: 5, rationale: "비중 축소" },
      valid: true,
      reasons: [],
    },
    {
      proposal: { kind: "buy", symbol: "ZZZZ", side: "BUY", quantity: 1, rationale: "환각 종목" },
      valid: false,
      reasons: ["unknown or non-tradable symbol"],
    },
  ],
  model: "stub-model",
  generatedAt: "2026-06-19T00:00:00Z",
};

describe("AiAdvisor", () => {
  it("renders the trigger button and disclaimer, and does not auto-fetch", () => {
    render(<AiAdvisor />);
    expect(screen.getByRole("button", { name: /조언 받기|분석/ })).toBeInTheDocument();
    expect(screen.getByText(/참고용/)).toBeInTheDocument();
    expect(fetchAdvisor).not.toHaveBeenCalled();
  });

  it("loads advice and proposals when the button is clicked", async () => {
    fetchAdvisor.mockResolvedValue(result);
    render(<AiAdvisor />);

    fireEvent.click(screen.getByRole("button", { name: /조언 받기|분석/ }));

    await waitFor(() => expect(screen.getByText(/분산을 고려하세요/)).toBeInTheDocument());
    expect(fetchAdvisor).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/005930/)).toBeInTheDocument();
  });

  it("offers prefill only for valid proposals; invalid ones show reasons", async () => {
    fetchAdvisor.mockResolvedValue(result);
    const onSelectProposal = vi.fn();
    render(<AiAdvisor onSelectProposal={onSelectProposal} />);

    fireEvent.click(screen.getByRole("button", { name: /조언 받기|분석/ }));
    await waitFor(() => expect(screen.getByText(/분산을 고려하세요/)).toBeInTheDocument());

    const prefillButtons = screen.getAllByRole("button", { name: /폼에 담기/ });
    expect(prefillButtons).toHaveLength(1);
    expect(screen.getByText(/unknown or non-tradable symbol/)).toBeInTheDocument();

    fireEvent.click(prefillButtons[0]);
    expect(onSelectProposal).toHaveBeenCalledWith(result.proposals[0].proposal);
  });

  it("shows a not-configured message when the advisor is not configured", async () => {
    fetchAdvisor.mockRejectedValue(
      new ApiClientError({ code: "advisor-not-configured", message: "nope", status: 503 }),
    );
    render(<AiAdvisor />);

    fireEvent.click(screen.getByRole("button", { name: /조언 받기|분석/ }));
    await waitFor(() => expect(screen.getByText(/설정되지 않았습니다/)).toBeInTheDocument());
  });

  it("shows a generic error message on other failures", async () => {
    fetchAdvisor.mockRejectedValue(
      new ApiClientError({ code: "advisor-response-invalid", message: "bad", status: 502 }),
    );
    render(<AiAdvisor />);

    fireEvent.click(screen.getByRole("button", { name: /조언 받기|분석/ }));
    await waitFor(() => expect(screen.getByText(/불러오지 못했습니다|bad/)).toBeInTheDocument());
  });
});
