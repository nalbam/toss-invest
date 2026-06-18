// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { OrderForm } from "./OrderForm";

// The form posts to `/api/orders` via the real `submitOrder`; mock `fetch` so we
// can assert the exact body that leaves the client and feed back each status.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

function fillBuyLimit() {
  fireEvent.change(screen.getByLabelText("종목코드"), {
    target: { value: "005930" },
  });
  fireEvent.change(screen.getByLabelText("수량"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("가격"), {
    target: { value: "71000" },
  });
}

describe("OrderForm", () => {
  it("renders the core fields and the confirm checkbox", () => {
    render(<OrderForm accountSeq={1} />);
    expect(screen.getByLabelText("종목코드")).toBeInTheDocument();
    expect(screen.getByLabelText("구분")).toBeInTheDocument();
    expect(screen.getByLabelText("유형")).toBeInTheDocument();
    expect(screen.getByLabelText("수량")).toBeInTheDocument();
    expect(
      screen.getByLabelText("실주문 확인 (confirm)"),
    ).toBeInTheDocument();
    // Confirm starts unchecked, so the dry-run hint is shown.
    expect(
      screen.getByText(
        "확인을 체크하지 않으면 dry-run 미리보기만 실행됩니다.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the price input for LIMIT and hides it for MARKET", () => {
    render(<OrderForm accountSeq={1} />);
    expect(screen.getByLabelText("가격")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("유형"), {
      target: { value: "MARKET" },
    });
    expect(screen.queryByLabelText("가격")).not.toBeInTheDocument();
  });

  it("submits confirm:false and renders the DRY_RUN preview", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "DRY_RUN",
          wouldSend: {
            symbol: "005930",
            side: "BUY",
            orderType: "LIMIT",
            quantity: "10",
            price: "71000",
          },
          reasons: ["dry-run-enabled"],
          prevalidation: {
            side: "BUY",
            available: "1000000",
            requested: "10",
            insufficient: false,
          },
        },
      }),
    );

    render(<OrderForm accountSeq={1} />);
    fillBuyLimit();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    expect(
      await screen.findByText("🔍 미리보기 (전송되지 않음)"),
    ).toBeInTheDocument();
    // The body carried confirm:false and the right order fields.
    const body = lastSentBody();
    expect(body.confirm).toBe(false);
    expect(body.symbol).toBe("005930");
    expect(body.quantity).toBe("10");
    expect(body.price).toBe("71000");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders?accountSeq=1");
    expect(screen.getByText("dry-run-enabled")).toBeInTheDocument();
  });

  it("submits confirm:true and renders SENT with the order id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "SENT",
          response: { orderId: "ord-123", clientOrderId: null },
          notionalKrw: 710000,
          prevalidation: {
            side: "BUY",
            available: "1000000",
            requested: "10",
            insufficient: false,
          },
        },
      }),
    );

    render(<OrderForm accountSeq={1} />);
    fillBuyLimit();
    fireEvent.click(screen.getByLabelText("실주문 확인 (confirm)"));
    fireEvent.click(screen.getByRole("button", { name: "주문 전송" }));

    expect(await screen.findByText("✅ 전송됨")).toBeInTheDocument();
    expect(screen.getByText("주문번호: ord-123")).toBeInTheDocument();
    expect(lastSentBody().confirm).toBe(true);
  });

  it("renders the BLOCKED reasons list", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "BLOCKED",
          request: {
            symbol: "AAPL",
            side: "BUY",
            orderType: "LIMIT",
            quantity: "1",
            price: "190",
          },
          reasons: ["max-order-amount-exceeded", "kill-switch-on"],
          prevalidation: {
            side: "BUY",
            available: null,
            requested: "1",
            insufficient: false,
          },
        },
      }),
    );

    render(<OrderForm accountSeq={1} />);
    fillBuyLimit();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    expect(await screen.findByText("⛔ 차단됨")).toBeInTheDocument();
    expect(screen.getByText("max-order-amount-exceeded")).toBeInTheDocument();
    expect(screen.getByText("kill-switch-on")).toBeInTheDocument();
  });

  it("renders the error code and message on an error envelope", async () => {
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

    render(<OrderForm accountSeq={1} />);
    fillBuyLimit();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    await waitFor(() => {
      expect(
        screen.getByText("[already-canceled] Order already canceled"),
      ).toBeInTheDocument();
    });
  });
});
