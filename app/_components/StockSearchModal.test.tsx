// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

type FavHook = {
  items: Array<{
    id: number;
    symbol: string;
    name: string | null;
    currency: string | null;
  }>;
  mutate: () => void;
  isLoading: boolean;
};

const { useFavorites, addFavoriteItem, removeFavoriteItem } = vi.hoisted(() => ({
  useFavorites: vi.fn(
    (): FavHook => ({ items: [], mutate: vi.fn(), isLoading: false }),
  ),
  addFavoriteItem: vi.fn(() => Promise.resolve({})),
  removeFavoriteItem: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/lib/client/favorites", () => ({
  useFavorites,
  addFavoriteItem,
  removeFavoriteItem,
}));

const { StockSearchModal } = await import("./StockSearchModal");

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useFavorites.mockReturnValue({ items: [], mutate: vi.fn(), isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("StockSearchModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <StockSearchModal open={false} onClose={() => {}} onSelectSymbol={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("searches the directory by name and selects a result", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/stocks/search")) {
        return Promise.resolve(
          jsonResponse({
            data: {
              items: [{ symbol: "000660", name: "SK하이닉스", currency: "KRW" }],
            },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const onSelectSymbol = vi.fn();
    const onClose = vi.fn();
    render(
      <StockSearchModal
        open
        onClose={onClose}
        onSelectSymbol={onSelectSymbol}
      />,
    );

    fireEvent.change(screen.getByLabelText("종목명 또는 코드"), {
      target: { value: "하이닉스" },
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    const result = await screen.findByRole("button", {
      name: /SK하이닉스 \(000660\)/,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/stocks/search?q="),
    );

    fireEvent.click(result);
    expect(onSelectSymbol).toHaveBeenCalledWith("000660", "SK하이닉스");
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to a code lookup when the directory has no match", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/stocks/search")) {
        return Promise.resolve(jsonResponse({ data: { items: [] } }));
      }
      if (url.includes("/api/stocks?symbols=")) {
        return Promise.resolve(
          jsonResponse({ data: [{ symbol: "AAPL", name: "Apple", currency: "USD" }] }),
        );
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(
      <StockSearchModal open onClose={() => {}} onSelectSymbol={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText("종목명 또는 코드"), {
      target: { value: "aapl" },
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByRole("button", { name: /Apple \(AAPL\)/ });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("symbols=AAPL"),
    );
  });

  it("lists favorites and selects one", () => {
    useFavorites.mockReturnValue({
      items: [{ id: 1, symbol: "005930", name: "삼성전자", currency: "KRW" }],
      mutate: vi.fn(),
      isLoading: false,
    });
    const onSelectSymbol = vi.fn();
    const onClose = vi.fn();
    render(
      <StockSearchModal
        open
        onClose={onClose}
        onSelectSymbol={onSelectSymbol}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /삼성전자 \(005930\)/ }));
    expect(onSelectSymbol).toHaveBeenCalledWith("005930", "삼성전자");
    expect(onClose).toHaveBeenCalled();
  });
});
