// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PortfolioSummary } from "./PortfolioSummary";
import type { HoldingsOverview } from "@/lib/client/types";
import styles from "./dashboard.module.css";

afterEach(cleanup);

const overview: HoldingsOverview = {
  totalPurchaseAmount: { krw: "10000000", usd: "7000.00" },
  marketValue: {
    amount: { krw: "11516000", usd: "8060.50" },
    amountAfterCost: { krw: "11500000", usd: "8050.00" },
  },
  profitLoss: {
    amount: { krw: "1516000", usd: "1060.50" },
    amountAfterCost: { krw: "1500000", usd: "1050.00" },
    rate: "0.1516",
    rateAfterCost: "0.15",
  },
  dailyProfitLoss: {
    amount: { krw: "-50000", usd: "-35.00" },
    rate: "-0.0043",
  },
  items: [],
};

describe("PortfolioSummary", () => {
  it("renders total market value with KRW and USD", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText("₩11,516,000")).toBeInTheDocument();
    expect(screen.getByText("$8,060.50")).toBeInTheDocument();
  });

  it("renders total profit/loss amount and percentage", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText("₩1,516,000")).toBeInTheDocument();
    expect(screen.getByText("+15.16%")).toBeInTheDocument();
  });

  it("renders daily profit/loss with its rate", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText("-₩50,000")).toBeInTheDocument();
    expect(screen.getByText("-0.43%")).toBeInTheDocument();
  });

  it("colors positive total P/L and negative daily P/L by sign", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText("₩1,516,000")).toHaveClass(styles.positive);
    expect(screen.getByText("-₩50,000")).toHaveClass(styles.negative);
  });
});
