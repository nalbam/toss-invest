// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HoldingsItem } from "@/lib/client/types";
import { HoldingsPnL, toPnlBars } from "./HoldingsPnL";

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
  profitLoss: { amount: "-97.50", amountAfterCost: "-100.00", rate: "-0.0929", rateAfterCost: "-0.0952" },
});

describe("toPnlBars", () => {
  it("sorts by rate, gains first, keeping the original rate text", () => {
    const bars = toPnlBars([apple, item()]);
    expect(bars.map((b) => b.symbol)).toEqual(["005930", "AAPL"]);
    expect(bars[0]).toMatchObject({ rate: 0.1077, rateText: "0.1077" });
    expect(bars[1].rate).toBeLessThan(0);
  });

  it("drops items with an unparseable rate", () => {
    const broken = item({ symbol: "X", profitLoss: { ...item().profitLoss, rate: "n/a" } });
    expect(toPnlBars([broken])).toEqual([]);
  });
});

describe("HoldingsPnL", () => {
  afterEach(cleanup);

  it("renders a bar row per holding with signed percent labels", () => {
    render(<HoldingsPnL items={[item(), apple]} />);
    expect(screen.getByText("삼성전자")).toBeInTheDocument();
    expect(screen.getByText("+10.77%")).toBeInTheDocument();
    expect(screen.getByText("-9.29%")).toBeInTheDocument();
  });

  it("renders an empty state with no holdings", () => {
    render(<HoldingsPnL items={[]} />);
    expect(screen.getByText("보유 종목 없음")).toBeInTheDocument();
  });
});
