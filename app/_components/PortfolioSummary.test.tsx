// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PortfolioSummary } from "./PortfolioSummary";
import type { HoldingsOverview } from "@/lib/client/types";
import styles from "./dashboard.module.css";

afterEach(cleanup);

/**
 * Matcher for a money amount whose currency symbol is split into its own span by
 * <Money>. Matching on the element's full textContent reassembles the symbol +
 * digits so the expected string stays the same as the rendered amount.
 */
const byMoney =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

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

/** Account cash (from buying-power); account total = market value + cash. */
const cash = { krw: "1000000", usd: "500.00" };

describe("PortfolioSummary", () => {
  it("renders total market value with KRW and USD", () => {
    render(<PortfolioSummary overview={overview} cash={cash} fxRate="1500" />);
    expect(screen.getByText(byMoney("₩11,516,000"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("$8,060.50"))).toBeInTheDocument();
  });

  it("renders 총 자산 = holdings + cash converted to KRW via fxRate", () => {
    render(<PortfolioSummary overview={overview} cash={cash} fxRate="1500" />);
    // 11,516,000 + 8,060.50*1500 + 1,000,000 + 500.00*1500
    //   = 11,516,000 + 12,090,750 + 1,000,000 + 750,000 = 25,356,750
    expect(screen.getByText(byMoney("₩25,356,750"))).toBeInTheDocument();
  });

  it("degrades the total to KRW parts when fxRate is missing", () => {
    render(<PortfolioSummary overview={overview} cash={cash} />);
    // No rate => USD parts count as 0: 11,516,000 + 1,000,000 = 12,516,000
    expect(screen.getByText(byMoney("₩12,516,000"))).toBeInTheDocument();
  });

  it("renders total profit/loss amount and percentage", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText(byMoney("₩1,516,000"))).toBeInTheDocument();
    expect(screen.getByText("+15.16%")).toBeInTheDocument();
  });

  it("renders the USD portion of P/L, not just KRW (currency breakdown)", () => {
    render(<PortfolioSummary overview={overview} />);
    // Regression: total/daily P&L dropped the USD portion, hiding USD holdings' P&L.
    expect(screen.getByText(byMoney("$1,060.50"))).toBeInTheDocument(); // total P&L USD
    expect(screen.getByText(byMoney("-$35.00"))).toBeInTheDocument(); // daily P&L USD
  });

  it("renders daily profit/loss with its rate", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText(byMoney("-₩50,000"))).toBeInTheDocument();
    expect(screen.getByText("-0.43%")).toBeInTheDocument();
  });

  it("colors positive total P/L and negative daily P/L by sign", () => {
    render(<PortfolioSummary overview={overview} />);
    expect(screen.getByText(byMoney("₩1,516,000"))).toHaveClass(styles.positive);
    expect(screen.getByText(byMoney("-₩50,000"))).toHaveClass(styles.negative);
  });
});
