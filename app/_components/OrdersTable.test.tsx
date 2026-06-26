// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { OrdersTable, summarizeCompletedTrades } from "./OrdersTable";
import type { Order } from "@/lib/client/types";

// Cancel/modify post to `/api/orders/{id}/...` via the real hooks; mock `fetch`
// so we can assert the exact body and feed back each status.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

/** Builds a `Response`-like object exposing `.ok`, `.status`, and `.json()`. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** The body the component sent on its most recent fetch call. */
function lastSentBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls.at(-1) ?? [];
  return JSON.parse((init as RequestInit).body as string);
}

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

const filledTerminal: Order = {
  ...buyLimit,
  orderId: "ord-3",
  status: "FILLED",
};

/** A market order with no fill yet: no order price and no average fill price. */
const marketUnfilled: Order = {
  ...sellUsPartial,
  orderId: "ord-4",
  status: "PENDING",
  execution: {
    ...sellUsPartial.execution,
    filledQuantity: "0",
    averageFilledPrice: null,
    filledAmount: null,
  },
};

/** Builds a terminal FILLED order with the given execution figures. */
function makeFill(over: {
  side: "BUY" | "SELL";
  filledQuantity: string;
  filledAmount?: string | null;
  averageFilledPrice?: string | null;
  commission?: string | null;
  tax?: string | null;
  currency?: "KRW" | "USD";
}): Order {
  return {
    ...buyLimit,
    orderId: `fill-${over.side}-${over.filledQuantity}`,
    side: over.side,
    status: "FILLED",
    currency: over.currency ?? "KRW",
    execution: {
      filledQuantity: over.filledQuantity,
      averageFilledPrice: over.averageFilledPrice ?? null,
      filledAmount: over.filledAmount ?? null,
      commission: over.commission ?? null,
      tax: over.tax ?? null,
      filledAt: "2026-03-25T10:00:00+09:00",
      settlementDate: null,
    },
  };
}

describe("OrdersTable", () => {
  it("renders a card per order with symbol, side, status, and filled/ordered quantity", () => {
    render(<OrdersTable orders={[buyLimit, sellUsPartial]} />);
    expect(screen.getByText("005930")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    // Side is shown as a ▲/▼ glyph labelled for assistive tech.
    expect(screen.getByLabelText("매수")).toBeInTheDocument();
    expect(screen.getByLabelText("매도")).toBeInTheDocument();
    // Status uses Korean badge labels.
    expect(screen.getByText("대기")).toBeInTheDocument();
    expect(screen.getByText("부분체결")).toBeInTheDocument();
    // Filled/ordered quantities are combined into one cell.
    expect(screen.getByText("0/10")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
    // Limit order shows its order price; the partially-filled market order shows
    // its average fill price (execution.averageFilledPrice).
    expect(screen.getByText(byMoney("₩71,000"))).toBeInTheDocument();
    expect(screen.getByText(byMoney("$190.50"))).toBeInTheDocument();
    // Time is shown as a relative age, with the full date-time as the tooltip.
    expect(screen.getByTitle("2026-03-25 09:30")).toBeInTheDocument();
    // One list item per order.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows a market order's average fill price, and 시장가 only while unfilled", () => {
    render(<OrdersTable orders={[sellUsPartial, marketUnfilled]} />);
    // Partially-filled market order: average fill price, flagged as such.
    expect(screen.getByText(byMoney("$190.50"))).toBeInTheDocument();
    expect(screen.getByTitle("체결 평균가")).toBeInTheDocument();
    // Unfilled market order has no price yet → "시장가".
    expect(screen.getByText("시장가")).toBeInTheDocument();
  });

  it("shows selected symbol orders above the full account order list", () => {
    render(
      <OrdersTable
        orders={[buyLimit, sellUsPartial]}
        selectedSymbol="005930"
      />,
    );

    expect(screen.getByRole("heading", { name: "005930 대기 주문" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "전체 대기 주문" })).toBeInTheDocument();
    const selectedSection = screen.getByLabelText("005930 대기 주문");
    // The symbol lives in the section heading, so cards drop the redundant code.
    expect(within(selectedSection).queryByText("005930")).not.toBeInTheDocument();
    // Only the selected symbol's order is in this section (the matching card,
    // shown as a 매수 ▲ glyph); the other symbol (AAPL) is not.
    expect(within(selectedSection).getByLabelText("매수")).toBeInTheDocument();
    expect(within(selectedSection).queryByText("AAPL")).not.toBeInTheDocument();
  });

  it("shows the selected symbol's completed orders in a separate section", () => {
    render(
      <OrdersTable
        orders={[buyLimit]}
        completedOrders={[filledTerminal]}
        selectedSymbol="005930"
        accountSeq={1}
      />,
    );

    const completedSection = screen.getByLabelText("005930 체결·완료 내역");
    expect(within(completedSection).getByText("체결")).toBeInTheDocument();
    // The pending section must not show the terminal order, and vice versa.
    const pendingSection = screen.getByLabelText("005930 대기 주문");
    expect(within(pendingSection).getByText("대기")).toBeInTheDocument();
    expect(within(pendingSection).queryByText("체결")).not.toBeInTheDocument();
    // Terminal orders expose no modify/cancel actions.
    expect(
      within(completedSection).queryByRole("button", { name: "취소" }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty selected symbol section when that symbol has no orders", () => {
    render(<OrdersTable orders={[sellUsPartial]} selectedSymbol="005930" />);

    expect(screen.getByRole("heading", { name: "005930 대기 주문" })).toBeInTheDocument();
    expect(screen.getByText("대기 주문 없음")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "005930 체결·완료 내역" })).toBeInTheDocument();
    expect(screen.getByText("완료 내역 없음")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "전체 대기 주문" })).toBeInTheDocument();
  });

  it("renders the empty state when there are no orders", () => {
    render(<OrdersTable orders={[]} />);
    expect(screen.getByText("주문 없음")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("offers modify/cancel actions only for cancelable (pending) orders", () => {
    render(<OrdersTable orders={[buyLimit, filledTerminal]} accountSeq={1} />);
    // Two pending-eligible? Only buyLimit is cancelable; FILLED is terminal.
    expect(screen.getAllByRole("button", { name: "취소" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "정정" })).toHaveLength(1);
  });

  it("reveals an inline confirm on 취소 click without calling fetch", () => {
    render(<OrdersTable orders={[buyLimit]} accountSeq={1} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByText("정말 취소?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "되돌리기" }),
    ).toBeInTheDocument();
    // Revealing the confirm prompt must not send any request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("되돌리기 dismisses the confirm without calling fetch", () => {
    render(<OrdersTable orders={[buyLimit]} accountSeq={1} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(screen.queryByText("정말 취소?")).not.toBeInTheDocument();
    // The original 취소 button is shown again.
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("확인 POSTs confirm:true to the cancel route and shows SENT", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { status: "SENT", response: { orderId: "ord-new" } },
      }),
    );

    render(<OrdersTable orders={[buyLimit]} accountSeq={7} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByText("✅ 취소 전송됨")).toBeInTheDocument();
    expect(screen.getByText("주문번호: ord-new")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/orders/ord-1/cancel?accountSeq=7",
    );
    expect(lastSentBody().confirm).toBe(true);
  });

  it("shows the DRY_RUN cancel preview with reasons (confirm:true may still preview)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "DRY_RUN",
          orderId: "ord-1",
          reasons: ["dry-run-enabled"],
        },
      }),
    );

    render(<OrdersTable orders={[buyLimit]} accountSeq={7} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(
      await screen.findByText("🔍 취소 미리보기 (전송되지 않음)"),
    ).toBeInTheDocument();
    expect(screen.getByText("dry-run-enabled")).toBeInTheDocument();
    expect(lastSentBody().confirm).toBe(true);
  });

  it("shows the BLOCKED cancel outcome with reasons", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "BLOCKED",
          orderId: "ord-1",
          reasons: ["kill-switch-on"],
        },
      }),
    );

    render(<OrdersTable orders={[buyLimit]} accountSeq={7} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByText("⛔ 차단됨")).toBeInTheDocument();
    expect(screen.getByText("kill-switch-on")).toBeInTheDocument();
  });

  it("shows the cancel error code/message on an error envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            requestId: "req-1",
            code: "already-canceled",
            message: "Order already canceled",
          },
        },
        409,
      ),
    );

    render(<OrdersTable orders={[buyLimit]} accountSeq={7} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => {
      expect(
        screen.getByText("[already-canceled] Order already canceled"),
      ).toBeInTheDocument();
    });
  });

  it("opens the inline modify form on 정정 click", () => {
    render(<OrdersTable orders={[buyLimit]} accountSeq={7} />);
    expect(screen.queryByLabelText("유형")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "정정" }));
    expect(screen.getByLabelText("유형")).toBeInTheDocument();
    // Prefilled from the order.
    expect((screen.getByLabelText("수량") as HTMLInputElement).value).toBe(
      "10",
    );
    expect((screen.getByLabelText("가격") as HTMLInputElement).value).toBe(
      "71000",
    );
  });

  it("calls onChanged after a SENT cancel", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { status: "SENT", response: { orderId: "ord-new" } },
      }),
    );
    const onChanged = vi.fn();

    render(
      <OrdersTable orders={[buyLimit]} accountSeq={7} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await screen.findByText("✅ 취소 전송됨");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not call onChanged on a DRY_RUN cancel", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "DRY_RUN",
          orderId: "ord-1",
          reasons: ["dry-run-enabled"],
        },
      }),
    );
    const onChanged = vi.fn();

    render(
      <OrdersTable orders={[buyLimit]} accountSeq={7} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await screen.findByText("🔍 취소 미리보기 (전송되지 않음)");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("isolates actions per card (cancel on one card only)", () => {
    render(
      <OrdersTable orders={[buyLimit, sellUsPartial]} accountSeq={1} />,
    );
    const cards = screen.getAllByRole("listitem");
    // Two cards, both pending => each has its own 취소 button.
    const firstCardCancel = within(cards[0]).getByRole("button", {
      name: "취소",
    });
    fireEvent.click(firstCardCancel);
    // Only one inline confirm prompt is shown.
    expect(screen.getAllByText("정말 취소?")).toHaveLength(1);
  });

  it("shows buy/sell totals and realized P&L above the completed orders", () => {
    const buyFill = makeFill({
      side: "BUY",
      filledQuantity: "10",
      filledAmount: "710000",
    });
    const sellFill = makeFill({
      side: "SELL",
      filledQuantity: "4",
      filledAmount: "300000",
    });
    render(
      <OrdersTable
        orders={[]}
        completedOrders={[buyFill, sellFill]}
        selectedSymbol="005930"
        averagePurchasePrice="50000"
        accountSeq={1}
      />,
    );

    const completedSection = screen.getByLabelText("005930 체결·완료 내역");
    // Summary rows: 매수 / 매도 / 실현손익 (labels are real text, not glyphs).
    expect(within(completedSection).getByText("매수")).toBeInTheDocument();
    expect(within(completedSection).getByText("매도")).toBeInTheDocument();
    expect(within(completedSection).getByText("실현손익")).toBeInTheDocument();
    // cost = 50000 × 4 = 200000; proceeds 300000 → +100000 (+50.00%)
    expect(
      within(completedSection).getByText(byMoney("+₩100,000")),
    ).toBeInTheDocument();
    expect(within(completedSection).getByText("(+50.00%)")).toBeInTheDocument();
    // The compact cards drop the redundant symbol code (it's in the heading).
    expect(
      within(completedSection).queryByText("005930"),
    ).not.toBeInTheDocument();
    // The summary amounts are flagged for privacy blur.
    expect(
      completedSection.querySelectorAll('[data-private-value="true"]').length,
    ).toBeGreaterThan(0);
  });

  it("flags order price and quantity as private for blur", () => {
    render(<OrdersTable orders={[buyLimit]} />);
    const card = screen.getByRole("listitem");
    // Price (₩71,000) and quantity (0/10) are both blur targets.
    expect(card.querySelectorAll('[data-private-value="true"]')).toHaveLength(2);
  });
});

describe("summarizeCompletedTrades", () => {
  it("computes realized P&L on the sold shares using the buy-average cost basis", () => {
    const buy = makeFill({
      side: "BUY",
      filledQuantity: "10",
      filledAmount: "710000",
    });
    const sell = makeFill({
      side: "SELL",
      filledQuantity: "6",
      filledAmount: "480000",
      commission: "100",
      tax: "1000",
    });
    const summary = summarizeCompletedTrades([buy, sell]);
    expect(summary).not.toBeNull();
    expect(summary?.buyQty).toBe("10");
    expect(summary?.sellQty).toBe("6");
    expect(summary?.buyAmount).toBe("710000");
    expect(summary?.sellAmount).toBe("480000");
    // cost = (710000 / 10) × 6 = 426000; proceeds = 480000 − 1100 fee = 478900
    // realized = 478900 − 426000 = 52900
    expect(summary?.realizedPnl).toBe("52900");
    expect(summary?.currency).toBe("KRW");
  });

  it("uses the passed average purchase price as the sold cost basis", () => {
    const sell = makeFill({
      side: "SELL",
      filledQuantity: "4",
      filledAmount: "300000",
    });
    // cost = 50000 × 4 = 200000; proceeds = 300000 → realized = 100000 (+50%)
    const summary = summarizeCompletedTrades([sell], "50000");
    expect(summary?.realizedPnl).toBe("100000");
    expect(summary?.realizedPnlRate).toBe("0.5");
  });

  it("returns null P&L when nothing was sold (no cost basis to realize)", () => {
    const buy = makeFill({
      side: "BUY",
      filledQuantity: "10",
      filledAmount: "710000",
    });
    expect(summarizeCompletedTrades([buy])?.realizedPnl).toBeNull();
  });

  it("ignores orders with no fill, returning null when none are filled", () => {
    expect(summarizeCompletedTrades([buyLimit, marketUnfilled])).toBeNull();
  });

  it("falls back to averageFilledPrice × filledQuantity when filledAmount is absent", () => {
    const sell = makeFill({
      side: "SELL",
      filledQuantity: "2",
      filledAmount: null,
      averageFilledPrice: "190.5",
      currency: "USD",
    });
    const summary = summarizeCompletedTrades([sell]);
    expect(summary?.sellAmount).toBe("381");
    // No buys loaded and no average price passed → no cost basis → null P&L.
    expect(summary?.realizedPnl).toBeNull();
    expect(summary?.currency).toBe("USD");
  });
});
