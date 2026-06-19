// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Orderbook } from "./Orderbook";
import type { OrderbookResponse } from "@/lib/client/types";

afterEach(cleanup);

/** Matches a money amount whose currency symbol is split into its own span by <Money>. */
const byMoney =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

const book: OrderbookResponse = {
  timestamp: "2026-03-25T09:30:00+09:00",
  currency: "KRW",
  // Asks arrive low-to-high.
  asks: [
    { price: "72100", volume: "10" },
    { price: "72200", volume: "20" },
  ],
  // Bids arrive high-to-low.
  bids: [
    { price: "72000", volume: "30" },
    { price: "71900", volume: "40" },
  ],
};

describe("Orderbook", () => {
  it("renders ask and bid rows with KRW prices and volumes", () => {
    render(<Orderbook book={book} />);
    expect(screen.getByText(byMoney("₩72,100"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩72,200"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩72,000"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("₩71,900"))).toBeInTheDocument();
    expect(screen.getAllByText("매도")).toHaveLength(2);
    expect(screen.getAllByText("매수")).toHaveLength(2);
    // header + 2 asks + 2 bids.
    expect(screen.getAllByRole("row")).toHaveLength(5);
  });

  it("renders the empty state when both sides are empty", () => {
    render(
      <Orderbook
        book={{ timestamp: null, currency: "KRW", asks: [], bids: [] }}
      />,
    );
    expect(screen.getByText("호가 정보 없음")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
