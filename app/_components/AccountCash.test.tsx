// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountCash } from "./AccountCash";
import type { ExchangeRateResponse } from "@/lib/client/types";

afterEach(cleanup);

/** Matches a money amount whose currency symbol is split into its own span by <Money>. */
const byMoney =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

const rate: ExchangeRateResponse = {
  baseCurrency: "USD",
  quoteCurrency: "KRW",
  rate: "1500",
  midRate: "1500",
  basisPoint: "0",
  rateChangeType: "UP",
  validFrom: "2026-06-19T09:00:00+09:00",
  validUntil: "2026-06-19T09:01:00+09:00",
};

const cash = { krw: "376980", usd: "1940.49" };

describe("AccountCash", () => {
  it("shows KRW/USD cash, the USD balance converted to KRW, and a KRW total", () => {
    render(<AccountCash rate={rate} cash={cash} />);
    // 1,940.49 * 1500 = 2,910,735; total = 376,980 + 2,910,735 = 3,287,715
    expect(screen.getByText(byMoney("₩3,287,715"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩376,980"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("$1,940.49"))).toBeInTheDocument();
    // USD balance shown converted to KRW (rendered as "≈ ₩2,910,735"); match the
    // innermost element exactly (whitespace-normalized) so ancestors don't match.
    expect(
      screen.getByText(
        (_, el) => el?.textContent?.replace(/\s/g, "") === "≈₩2,910,735",
      ),
    ).toBeInTheDocument();
  });

  it("shows the exchange rate as a labeled caption", () => {
    render(<AccountCash rate={rate} cash={cash} />);
    expect(screen.getByText("환율")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.getByText("USD/KRW")).toBeInTheDocument();
    expect(screen.getByText("▲ 상승")).toBeInTheDocument();
  });

  it("renders without cash (still shows the rate, balances as -)", () => {
    render(<AccountCash rate={rate} />);
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });
});
