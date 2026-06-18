// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import type { HoldingsItem } from "@/lib/client/types";

afterEach(cleanup);

const samsung: HoldingsItem = {
  symbol: "005930",
  name: "삼성전자",
  marketCountry: "KR",
  currency: "KRW",
  quantity: "10",
  lastPrice: "72000",
  averagePurchasePrice: "65000",
  marketValue: { purchaseAmount: "650000", amount: "720000", amountAfterCost: "719000" },
  profitLoss: {
    amount: "70000",
    amountAfterCost: "69000",
    rate: "0.1077",
    rateAfterCost: "0.1062",
  },
  dailyProfitLoss: { amount: "5000", rate: "0.007" },
  cost: { commission: "100", tax: null },
};

const apple: HoldingsItem = {
  symbol: "AAPL",
  name: "Apple",
  marketCountry: "US",
  currency: "USD",
  quantity: "5",
  lastPrice: "190.50",
  averagePurchasePrice: "210.00",
  marketValue: { purchaseAmount: "1450000", amount: "1300000", amountAfterCost: "1298000" },
  profitLoss: {
    amount: "-150000",
    amountAfterCost: "-152000",
    rate: "-0.1034",
    rateAfterCost: "-0.1048",
  },
  dailyProfitLoss: { amount: "-2000", rate: "-0.0015" },
  cost: { commission: "1.5", tax: null },
};

describe("HoldingsTable", () => {
  it("renders a row per holding with names and US/KR prices", () => {
    render(<HoldingsTable items={[samsung, apple]} />);
    expect(screen.getByText("삼성전자")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    // KR price formatted as KRW, US price formatted as USD.
    expect(screen.getByText("₩72,000")).toBeInTheDocument();
    expect(screen.getByText("$190.50")).toBeInTheDocument();
    // Two data rows rendered.
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 rows
  });

  it("renders the empty state when there are no holdings", () => {
    render(<HoldingsTable items={[]} />);
    expect(screen.getByText("보유 종목 없음")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
