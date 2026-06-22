// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { OrderbookResponse } from "@/lib/client/types";
import { OrderbookDepth, toDepth } from "./OrderbookDepth";

function book(overrides: Partial<OrderbookResponse> = {}): OrderbookResponse {
  return {
    timestamp: "2026-03-25T09:00:00+09:00",
    currency: "KRW",
    asks: [
      { price: "101", volume: "5" },
      { price: "102", volume: "3" },
    ],
    bids: [
      { price: "100", volume: "4" },
      { price: "99", volume: "6" },
    ],
    ...overrides,
  };
}

describe("toDepth", () => {
  it("accumulates bids high→low and asks low→high", () => {
    const depth = toDepth(book());
    // Bids: best (100) first, cumulative grows toward lower prices.
    expect(depth.bids).toEqual([
      { price: 100, cumulative: 4 },
      { price: 99, cumulative: 10 },
    ]);
    // Asks: best (101) first, cumulative grows toward higher prices.
    expect(depth.asks).toEqual([
      { price: 101, cumulative: 5 },
      { price: 102, cumulative: 8 },
    ]);
    expect(depth.maxCumulative).toBe(10);
  });

  it("drops entries with unparseable price or volume", () => {
    const depth = toDepth(
      book({
        bids: [
          { price: "100", volume: "4" },
          { price: "abc", volume: "6" },
        ],
        asks: [{ price: "101", volume: "x" }],
      }),
    );
    expect(depth.bids).toEqual([{ price: 100, cumulative: 4 }]);
    expect(depth.asks).toEqual([]);
    expect(depth.maxCumulative).toBe(4);
  });

  it("drops entries with empty price or volume strings", () => {
    const depth = toDepth(
      book({
        bids: [
          { price: "100", volume: "4" },
          { price: "", volume: "6" },
        ],
        asks: [{ price: "101", volume: "" }],
      }),
    );
    expect(depth.bids).toEqual([{ price: 100, cumulative: 4 }]);
    expect(depth.asks).toEqual([]);
    expect(depth.maxCumulative).toBe(4);
  });

  it("handles an empty book", () => {
    const depth = toDepth(book({ asks: [], bids: [] }));
    expect(depth).toEqual({ bids: [], asks: [], maxCumulative: 0 });
  });
});

describe("OrderbookDepth", () => {
  afterEach(cleanup);

  it("renders two area paths for a populated book", () => {
    const { container } = render(<OrderbookDepth book={book()} />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(screen.getByLabelText("호가 뎁스 차트")).toBeTruthy();
  });

  it("renders an empty state when the book is empty", () => {
    render(<OrderbookDepth book={book({ asks: [], bids: [] })} />);
    expect(screen.getByText("호가 정보 없음")).toBeTruthy();
    expect(screen.queryByLabelText("호가 뎁스 차트")).toBeNull();
  });
});
