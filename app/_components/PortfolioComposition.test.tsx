// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HoldingsItem } from "@/lib/client/types";
import {
  PortfolioComposition,
  toComposition,
} from "./PortfolioComposition";

function item(overrides: Partial<HoldingsItem> = {}): HoldingsItem {
  return {
    symbol: "005930",
    name: "삼성전자",
    marketCountry: "KR",
    currency: "KRW",
    quantity: "10",
    lastPrice: "72000",
    averagePurchasePrice: "65000",
    marketValue: { purchaseAmount: "650000", amount: "720000", amountAfterCost: "719000" },
    profitLoss: { amount: "70000", amountAfterCost: "69000", rate: "0.1077", rateAfterCost: "0.1062" },
    dailyProfitLoss: { amount: "5000", rate: "0.007" },
    cost: { commission: "100", tax: null },
    ...overrides,
  };
}

const apple = item({
  symbol: "AAPL",
  name: "Apple",
  marketCountry: "US",
  currency: "USD",
  marketValue: { purchaseAmount: "1050.00", amount: "952.50", amountAfterCost: "950.00" },
});

describe("toComposition", () => {
  it("converts USD holdings to KRW with the fx rate and sorts by value", () => {
    const segments = toComposition([item(), apple], "1300");
    // apple: 952.50 * 1300 = 1,238,250 (largest) > samsung 720,000
    expect(segments.map((s) => s.symbol)).toEqual(["AAPL", "005930"]);
    const sum = segments.reduce((acc, s) => acc + s.percent, 0);
    expect(sum).toBeCloseTo(100, 5);
    expect(segments[0].percent).toBeGreaterThan(segments[1].percent);
  });

  it("falls back to the raw amount when no fx rate is given", () => {
    const segments = toComposition([item(), apple]);
    // Without conversion samsung (720,000) dominates apple (952.50).
    expect(segments[0].symbol).toBe("005930");
  });

  it("drops non-positive or unparseable values and returns [] when empty", () => {
    const zero = item({ symbol: "Z", marketValue: { purchaseAmount: "0", amount: "0", amountAfterCost: "0" } });
    expect(toComposition([zero])).toEqual([]);
  });
});

describe("PortfolioComposition", () => {
  afterEach(cleanup);

  it("renders a donut arc and legend entry per segment", () => {
    const { container } = render(
      <PortfolioComposition items={[item(), apple]} fxRate="1300" />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    expect(screen.getByText("삼성전자")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("renders an empty state with no holdings", () => {
    render(<PortfolioComposition items={[]} />);
    expect(screen.getByText("보유 종목 없음")).toBeInTheDocument();
  });
});
