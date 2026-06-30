// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import { __resetSettingsStore, __seedSettings } from "./settingsStore";
import type { HoldingsItem } from "@/lib/client/types";

afterEach(() => {
  cleanup();
  __resetSettingsStore();
});

/**
 * Matcher for a money amount whose currency symbol is split into its own span by
 * <Money>. Matching on the element's full textContent reassembles the symbol +
 * digits so the expected string stays the same as the rendered amount.
 */
const byMoney =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

const byTextContent =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

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
  // USD holding: amounts are in the item's native currency (USD), not KRW.
  marketValue: { purchaseAmount: "1050.00", amount: "952.50", amountAfterCost: "950.00" },
  profitLoss: {
    amount: "-97.50",
    amountAfterCost: "-100.00",
    rate: "-0.0929",
    rateAfterCost: "-0.0952",
  },
  dailyProfitLoss: { amount: "-7.50", rate: "-0.0078" },
  cost: { commission: "1.5", tax: null },
};

const longNameEtf: HoldingsItem = {
  ...samsung,
  symbol: "487240",
  name: "SOL AI반도체TOP2플러스",
};

describe("HoldingsTable", () => {
  it("renders a row per holding with names and US/KR prices", () => {
    render(<HoldingsTable items={[samsung, apple]} />);
    expect(screen.getByText("삼성전자")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    // KR price formatted as KRW, US price formatted as USD.
    expect(screen.getByText(byMoney("₩72,000"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("$190.50"))).toBeInTheDocument();
    expect(screen.getByText(byTextContent("005930 · KR · 10주"))).toBeInTheDocument();
    expect(screen.getByText(byTextContent("AAPL · US · 5주"))).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("formats USD holding amounts in USD ($), not KRW (currency-aware)", () => {
    render(<HoldingsTable items={[samsung, apple]} />);
    // Regression: market value and total P&L of a USD holding were
    // hardcoded to ₩ (showed e.g. ₩279 for a $279 position). Must use $.
    expect(screen.getByText(byMoney("$952.50"))).toBeInTheDocument(); // market value
    expect(screen.getByText(byTextContent("-$97.50 (-9.29%)"))).toBeInTheDocument(); // total P&L amount
    // KRW holding's market value still uses ₩.
    expect(screen.getByText(byMoney("₩720,000"))).toBeInTheDocument();
  });

  it("shows quantity, current price, average price, and purchase amount", () => {
    render(<HoldingsTable items={[samsung]} />);
    expect(screen.getByText(byTextContent("005930 · KR · 10주"))).toBeInTheDocument();
    expect(screen.getByText("현재가")).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩72,000"))).toBeInTheDocument();
    expect(screen.getByText("평균단가")).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩65,000"))).toBeInTheDocument();
    expect(screen.getByText("매입금액")).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩650,000"))).toBeInTheDocument();
  });

  it("renders the empty state when there are no holdings", () => {
    render(<HoldingsTable items={[]} />);
    expect(screen.getByText("보유 종목 없음")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a holdings summary when collapsed", async () => {
    __seedSettings({ "toss-invest:collapsed:holdings": "true" });

    render(<HoldingsTable items={[longNameEtf, apple]} />);

    expect(await screen.findByText("SOL AI반도체TOP2플러스")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩720,000"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("$952.50"))).toBeInTheDocument();
    expect(screen.queryByText(byTextContent("487240 · KR · 10주"))).not.toBeInTheDocument();
  });

  it("shows an empty holdings summary when collapsed", async () => {
    __seedSettings({ "toss-invest:collapsed:holdings": "true" });

    render(<HoldingsTable items={[]} />);

    expect(await screen.findByText("보유 종목 없음")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("calls onSelectSymbol with the row's symbol when the row is clicked", () => {
    const onSelectSymbol = vi.fn();
    render(
      <HoldingsTable
        items={[samsung, apple]}
        onSelectSymbol={onSelectSymbol}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apple/ }));
    expect(onSelectSymbol).toHaveBeenCalledWith("AAPL");
  });

  it("marks the selected holding with aria-pressed when selectedSymbol matches", () => {
    render(
      <HoldingsTable
        items={[samsung, apple]}
        selectedSymbol="AAPL"
        onSelectSymbol={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Apple/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /삼성전자/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders non-interactive symbol cells when no onSelectSymbol is given", () => {
    render(<HoldingsTable items={[samsung]} />);
    expect(screen.queryByRole("button", { name: /삼성전자/ })).not.toBeInTheDocument();
  });
});
