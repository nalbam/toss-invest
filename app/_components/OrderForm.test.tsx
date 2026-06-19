// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SWRConfig } from "swr";
import { OrderForm } from "./OrderForm";

// Each render gets a fresh SWR cache so price/sellable reads never leak between
// tests (e.g. an AAPL price cached by one test bleeding into the next).
function renderForm(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>,
  );
}

// The form posts to `/api/orders` via the real `submitOrder`; mock `fetch` so we
// can assert the exact body that leaves the client and feed back each status.
// Quick mode also fetches `/api/prices` and `/api/sellable-quantity`.
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

/** Dispatches GET reads (prices / sellable) and routes POSTs to `onPost`. */
function quoteFetch(
  onPost: (url: string, init: RequestInit) => unknown,
  reads: {
    price?: { lastPrice: string; currency: string };
    sellable?: string;
  } = {},
) {
  const price = reads.price ?? { lastPrice: "71000", currency: "KRW" };
  const sellable = reads.sellable ?? "0";
  return async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return onPost(url, init);
    }
    if (url.startsWith("/api/prices")) {
      return jsonResponse({
        data: [{ symbol: url.includes("AAPL") ? "AAPL" : "005930", ...price }],
      });
    }
    if (url.startsWith("/api/sellable-quantity")) {
      return jsonResponse({ data: { sellableQuantity: sellable } });
    }
    throw new Error(`unexpected GET ${url}`);
  };
}

/** The body of the most recent POST fetch call. */
function lastPostBody(): Record<string, unknown> {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return JSON.parse((call![1] as RequestInit).body as string);
}

/** Whether any POST has been issued yet. */
function hasPosted(): boolean {
  return fetchMock.mock.calls.some(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
}

function goGeneral() {
  fireEvent.click(screen.getByRole("tab", { name: "일반주문" }));
}

function fillBuyLimit() {
  fireEvent.change(screen.getByLabelText("종목코드"), {
    target: { value: "005930" },
  });
  fireEvent.change(screen.getByLabelText("수량"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("구매 가격"), {
    target: { value: "71000" },
  });
}

describe("OrderForm — quick order (default)", () => {
  it("defaults to the quick order tab", () => {
    fetchMock.mockImplementation(quoteFetch(() => jsonResponse({ data: {} })));
    renderForm(<OrderForm accountSeq={1} symbol="AAPL" />);
    expect(screen.getByRole("tab", { name: "빠른주문" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "일반주문" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByLabelText("몇 주 주문할까요?")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /현재가 구매/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /현재가 판매/ }),
    ).toBeInTheDocument();
  });

  it("shows the live price, currency, buying power and capacities", async () => {
    fetchMock.mockImplementation(
      quoteFetch(() => jsonResponse({ data: {} }), {
        price: { lastPrice: "71000", currency: "KRW" },
        sellable: "10",
      }),
    );

    renderForm(
      <OrderForm
        accountSeq={1}
        symbol="005930"
        name="삼성전자"
        cash={{ krw: "1000000", usd: "5000" }}
      />,
    );

    // Price + currency badge.
    expect(await screen.findByText("₩71,000")).toBeInTheDocument();
    expect(screen.getByText("KRW ₩")).toBeInTheDocument();
    // Buying power (from props) in the trade currency.
    expect(screen.getByText("₩1,000,000")).toBeInTheDocument();
    // Max buyable = floor(1,000,000 / 71,000) = 14; sellable from the API.
    expect(await screen.findByText("14주")).toBeInTheDocument();
    expect(await screen.findByText("10주")).toBeInTheDocument();
  });

  it("fills the quantity from the 구매가능 capacity chip", async () => {
    fetchMock.mockImplementation(
      quoteFetch(() => jsonResponse({ data: {} }), {
        price: { lastPrice: "71000", currency: "KRW" },
        sellable: "10",
      }),
    );

    renderForm(
      <OrderForm accountSeq={1} symbol="005930" cash={{ krw: "1000000" }} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /구매가능/ }));
    expect(screen.getByLabelText("몇 주 주문할까요?")).toHaveValue("14");
  });

  it("arms then confirms a current-price LIMIT BUY with confirm:true", async () => {
    fetchMock.mockImplementation(
      quoteFetch(
        () =>
          jsonResponse({
            data: {
              status: "SENT",
              response: { orderId: "ord-9", clientOrderId: null },
              notionalKrw: 557100,
              prevalidation: {
                side: "BUY",
                available: "5000",
                requested: "3",
                insufficient: false,
              },
            },
          }),
        { price: { lastPrice: "185.70", currency: "USD" }, sellable: "10" },
      ),
    );

    renderForm(
      <OrderForm
        accountSeq={1}
        symbol="AAPL"
        cash={{ usd: "5000" }}
        fxRate="1350"
      />,
    );

    await screen.findByText("$185.70");
    fireEvent.change(screen.getByLabelText("몇 주 주문할까요?"), {
      target: { value: "3" },
    });

    // First click arms the confirmation — nothing is sent yet.
    fireEvent.click(screen.getByRole("button", { name: /현재가 구매/ }));
    expect(screen.getByText(/정말 구매하시겠어요\?/)).toBeInTheDocument();
    expect(hasPosted()).toBe(false);

    // Second click sends the real order.
    fireEvent.click(screen.getByRole("button", { name: "구매 확정" }));
    expect(await screen.findByText("✅ 전송됨")).toBeInTheDocument();
    expect(screen.getByText("주문번호: ord-9")).toBeInTheDocument();
    expect(lastPostBody()).toMatchObject({
      symbol: "AAPL",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: "3",
      price: "185.70",
      confirm: true,
    });
  });

  it("disarms the confirmation with 되돌리기 without sending", async () => {
    fetchMock.mockImplementation(
      quoteFetch(() => jsonResponse({ data: {} }), {
        price: { lastPrice: "71000", currency: "KRW" },
      }),
    );

    renderForm(
      <OrderForm accountSeq={1} symbol="005930" cash={{ krw: "1000000" }} />,
    );
    await screen.findByText("₩71,000");
    fireEvent.change(screen.getByLabelText("몇 주 주문할까요?"), {
      target: { value: "2" },
    });

    fireEvent.click(screen.getByRole("button", { name: /현재가 판매/ }));
    expect(screen.getByRole("button", { name: "판매 확정" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(
      screen.queryByRole("button", { name: "판매 확정" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /현재가 판매/ }),
    ).toBeInTheDocument();
    expect(hasPosted()).toBe(false);
  });
});

describe("OrderForm — general order", () => {
  it("renders the core fields and the confirm checkbox", () => {
    renderForm(<OrderForm accountSeq={1} />);
    goGeneral();
    expect(screen.getByLabelText("종목코드")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구매" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "판매" })).toBeInTheDocument();
    expect(screen.getByLabelText("주문 유형")).toBeInTheDocument();
    expect(screen.getByLabelText("수량")).toBeInTheDocument();
    expect(screen.getByLabelText("실주문 확인 (confirm)")).toBeInTheDocument();
    // Confirm starts unchecked, so the dry-run hint is shown.
    expect(
      screen.getByText("확인을 체크하지 않으면 dry-run 미리보기만 실행됩니다."),
    ).toBeInTheDocument();
  });

  it("prefills the symbol field from the symbol prop", () => {
    renderForm(<OrderForm accountSeq={1} symbol="AAPL" />);
    goGeneral();
    expect(screen.getByLabelText("종목코드")).toHaveValue("AAPL");
  });

  it("shows the price input for LIMIT and hides it for MARKET", () => {
    renderForm(<OrderForm accountSeq={1} />);
    goGeneral();
    expect(screen.getByLabelText("구매 가격")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("주문 유형"), {
      target: { value: "MARKET" },
    });
    expect(screen.queryByLabelText("구매 가격")).not.toBeInTheDocument();
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

    renderForm(<OrderForm accountSeq={1} />);
    goGeneral();
    fillBuyLimit();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    expect(
      await screen.findByText("🔍 미리보기 (전송되지 않음)"),
    ).toBeInTheDocument();
    const body = lastPostBody();
    expect(body.confirm).toBe(false);
    expect(body.symbol).toBe("005930");
    expect(body.quantity).toBe("10");
    expect(body.price).toBe("71000");
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

    renderForm(<OrderForm accountSeq={1} />);
    goGeneral();
    fillBuyLimit();
    fireEvent.click(screen.getByLabelText("실주문 확인 (confirm)"));
    fireEvent.click(screen.getByRole("button", { name: "구매하기" }));

    expect(await screen.findByText("✅ 전송됨")).toBeInTheDocument();
    expect(screen.getByText("주문번호: ord-123")).toBeInTheDocument();
    expect(lastPostBody().confirm).toBe(true);
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

    renderForm(<OrderForm accountSeq={1} />);
    goGeneral();
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

    renderForm(<OrderForm accountSeq={1} />);
    goGeneral();
    fillBuyLimit();
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    await waitFor(() => {
      expect(
        screen.getByText("[already-canceled] Order already canceled"),
      ).toBeInTheDocument();
    });
  });

  it("prefills side and quantity from a proposal without arming or confirming (§6.A-2)", () => {
    fetchMock.mockImplementation(quoteFetch(() => jsonResponse({ data: {} })));
    renderForm(
      <OrderForm accountSeq={1} symbol="005930" prefill={{ side: "SELL", quantity: 7 }} />,
    );
    goGeneral();

    expect(screen.getByRole("button", { name: "판매" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("수량")).toHaveDisplayValue("7");
    // The confirm box is never auto-checked, and nothing is sent — the user must
    // still confirm and pass the §6 gate.
    expect(screen.getByLabelText("실주문 확인 (confirm)")).not.toBeChecked();
    expect(hasPosted()).toBe(false);
  });
});
