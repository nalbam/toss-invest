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
import { OrdersTable } from "./OrdersTable";
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
    expect(screen.getByText(byMoney("₩71,000"))).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    // Ordered time trimmed to date + HH:mm.
    expect(screen.getByText("2026-03-25 09:30")).toBeInTheDocument();
    // header + 2 rows.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("shows selected symbol orders above the full account order list", () => {
    render(
      <OrdersTable
        orders={[buyLimit, sellUsPartial]}
        selectedSymbol="005930"
      />,
    );

    expect(screen.getByRole("heading", { name: "005930 주문 내역" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "전체 주문 내역" })).toBeInTheDocument();
    const selectedSection = screen.getByLabelText("005930 주문 내역");
    expect(within(selectedSection).getByText("005930")).toBeInTheDocument();
    expect(within(selectedSection).queryByText("AAPL")).not.toBeInTheDocument();
  });

  it("shows an empty selected symbol section when that symbol has no orders", () => {
    render(<OrdersTable orders={[sellUsPartial]} selectedSymbol="005930" />);

    expect(screen.getByRole("heading", { name: "005930 주문 내역" })).toBeInTheDocument();
    expect(screen.getByText("해당 종목 주문 없음")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "전체 주문 내역" })).toBeInTheDocument();
  });

  it("renders the empty state when there are no orders", () => {
    render(<OrdersTable orders={[]} />);
    expect(screen.getByText("주문 없음")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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

  it("isolates actions per row (cancel on one row only)", () => {
    render(
      <OrdersTable orders={[buyLimit, sellUsPartial]} accountSeq={1} />,
    );
    const rows = screen.getAllByRole("row");
    // header + 2 data rows; both pending => each has its own 취소 button.
    const firstRowCancel = within(rows[1]).getByRole("button", {
      name: "취소",
    });
    fireEvent.click(firstRowCancel);
    // Only one inline confirm prompt is shown.
    expect(screen.getAllByText("정말 취소?")).toHaveLength(1);
  });
});
