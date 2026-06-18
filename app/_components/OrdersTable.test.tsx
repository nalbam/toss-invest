// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrdersTable } from "./OrdersTable";
import type { Order } from "@/lib/client/types";

afterEach(cleanup);

const buyLimit: Order = {
  orderId: "ord-1",
  symbol: "005930",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  status: "PENDING",
  price: "71000",
  quantity: "10",
  orderAmount: "710000",
  currency: "KRW",
  orderedAt: "2026-03-25T09:30:00+09:00",
  canceledAt: null,
  execution: {
    filledQuantity: "0",
    averageFilledPrice: null,
    filledAmount: null,
    commission: null,
    tax: null,
    filledAt: null,
    settlementDate: null,
  },
};

const sellUsPartial: Order = {
  orderId: "ord-2",
  symbol: "AAPL",
  side: "SELL",
  orderType: "MARKET",
  timeInForce: "DAY",
  status: "PARTIAL_FILLED",
  price: null,
  quantity: "5",
  orderAmount: null,
  currency: "USD",
  orderedAt: "2026-03-25T10:00:00-04:00",
  canceledAt: null,
  execution: {
    filledQuantity: "2",
    averageFilledPrice: "190.50",
    filledAmount: "381.00",
    commission: "1.0",
    tax: null,
    filledAt: "2026-03-25T10:00:05-04:00",
    settlementDate: "2026-03-27",
  },
};

describe("OrdersTable", () => {
  it("renders a row per order with symbol, side, status, and filled quantity", () => {
    render(<OrdersTable orders={[buyLimit, sellUsPartial]} />);
    expect(screen.getByText("005930")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();
    expect(screen.getByText("PARTIAL_FILLED")).toBeInTheDocument();
    // KRW limit price formatted; market order with null price renders "-".
    expect(screen.getByText("₩71,000")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    // Ordered time trimmed to date + HH:mm.
    expect(screen.getByText("2026-03-25 09:30")).toBeInTheDocument();
    // header + 2 rows.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("renders the empty state when there are no orders", () => {
    render(<OrdersTable orders={[]} />);
    expect(screen.getByText("주문 없음")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
