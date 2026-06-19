// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ModifyOrderForm } from "./ModifyOrderForm";

// The form posts to `/api/orders/{id}/modify` via the real `modifyOrder`; mock
// `fetch` so we can assert the exact body and feed back each status.
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

function renderForm(props?: Partial<Parameters<typeof ModifyOrderForm>[0]>) {
  return render(
    <ModifyOrderForm
      accountSeq={7}
      orderId="ord-1"
      defaultOrderType="LIMIT"
      defaultQuantity="10"
      defaultPrice="71000"
      {...props}
    />,
  );
}

describe("ModifyOrderForm", () => {
  it("renders prefilled fields and the confirm checkbox", () => {
    renderForm();
    expect((screen.getByLabelText("유형") as HTMLSelectElement).value).toBe(
      "LIMIT",
    );
    expect((screen.getByLabelText("수량") as HTMLInputElement).value).toBe(
      "10",
    );
    expect((screen.getByLabelText("가격") as HTMLInputElement).value).toBe(
      "71000",
    );
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

  it("hides the price field for MARKET", () => {
    renderForm();
    expect(screen.getByLabelText("가격")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("유형"), {
      target: { value: "MARKET" },
    });
    expect(screen.queryByLabelText("가격")).not.toBeInTheDocument();
  });

  it("submits confirm:false to the modify route and renders the DRY_RUN preview", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "DRY_RUN",
          wouldSend: { orderType: "LIMIT", quantity: "10", price: "73000" },
          reasons: ["dry-run-enabled"],
        },
      }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText("가격"), {
      target: { value: "73000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    expect(
      await screen.findByText("🔍 미리보기 (전송되지 않음)"),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/orders/ord-1/modify?accountSeq=7",
    );
    const body = lastSentBody();
    expect(body.confirm).toBe(false);
    expect(body.orderType).toBe("LIMIT");
    expect(body.quantity).toBe("10");
    expect(body.price).toBe("73000");
    expect(screen.getByText("dry-run-enabled")).toBeInTheDocument();
  });

  it("submits confirm:true and renders SENT with the new order id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "SENT",
          response: { orderId: "ord-new" },
          notionalKrw: 730000,
        },
      }),
    );
    const onModified = vi.fn();

    renderForm({ onModified });
    fireEvent.click(screen.getByLabelText("실주문 확인 (confirm)"));
    fireEvent.click(screen.getByRole("button", { name: "정정 전송" }));

    expect(await screen.findByText("✅ 정정 전송됨")).toBeInTheDocument();
    expect(screen.getByText("주문번호: ord-new")).toBeInTheDocument();
    expect(lastSentBody().confirm).toBe(true);
    expect(onModified).toHaveBeenCalledTimes(1);
  });

  it("does not call onModified on a DRY_RUN result", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "DRY_RUN",
          wouldSend: { orderType: "LIMIT", quantity: "10", price: "71000" },
          reasons: ["not-confirmed"],
        },
      }),
    );
    const onModified = vi.fn();

    renderForm({ onModified });
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    await screen.findByText("🔍 미리보기 (전송되지 않음)");
    expect(onModified).not.toHaveBeenCalled();
  });

  it("renders the BLOCKED reasons list", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          status: "BLOCKED",
          request: { orderType: "LIMIT", quantity: "10", price: "71000" },
          reasons: ["max-order-amount-exceeded"],
        },
      }),
    );

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    expect(await screen.findByText("⛔ 차단됨")).toBeInTheDocument();
    expect(screen.getByText("max-order-amount-exceeded")).toBeInTheDocument();
  });

  it("renders the error code and message on an error envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            requestId: "req-1",
            code: "already-filled",
            message: "Order already filled",
          },
        },
        409,
      ),
    );

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    await waitFor(() => {
      expect(
        screen.getByText("[already-filled] Order already filled"),
      ).toBeInTheDocument();
    });
  });
});
