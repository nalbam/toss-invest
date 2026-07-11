import { beforeEach, describe, expect, it, vi } from "vitest";

// The store itself is exercised elsewhere; here we mock it so the route's
// input validation + error mapping are tested in isolation (no test file
// previously existed for this route at all).
const { addFavorite, listFavorites, removeFavorite, upsertStockDirectory } = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  listFavorites: vi.fn(() => [] as unknown[]),
  removeFavorite: vi.fn(),
  upsertStockDirectory: vi.fn(),
}));

vi.mock("@/lib/server/favorites/store", () => ({ addFavorite, listFavorites, removeFavorite }));
vi.mock("@/lib/server/stocks/directory", () => ({ upsertStockDirectory }));

// Plain function (not vi.fn) so the per-test `vi.clearAllMocks()` never wipes it
// and the route sees an authenticated session under `withAuth`.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "test" } }) } },
}));

import { DELETE, GET, POST } from "./route";

function getRequest() {
  return new Request("http://test/api/favorites");
}

function postRequest(body: unknown, raw?: string) {
  return new Request("http://test/api/favorites", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  });
}

function deleteRequest(symbol: string | null) {
  const url = new URL("http://test/api/favorites");
  if (symbol !== null) url.searchParams.set("symbol", symbol);
  return new Request(url, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("favorites route — GET", () => {
  it("returns the stored favorites in an envelope", async () => {
    listFavorites.mockReturnValue([{ symbol: "005930", name: "삼성전자", currency: "KRW" }]);
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(1);
  });
});

describe("favorites route — POST", () => {
  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(postRequest(undefined, "not json"));
    expect(res.status).toBe(400);
    expect(addFavorite).not.toHaveBeenCalled();
  });

  it("returns 400 for a symbol with characters outside the allowed pattern", async () => {
    const res = await POST(postRequest({ symbol: "AB CD" }));
    expect(res.status).toBe(400);
    expect(addFavorite).not.toHaveBeenCalled();
  });

  it("adds a valid favorite and seeds the stock directory when a name is given", async () => {
    addFavorite.mockReturnValue({ symbol: "AAPL", name: "Apple", currency: "USD" });
    const res = await POST(postRequest({ symbol: "AAPL", name: "Apple", currency: "USD" }));
    expect(res.status).toBe(200);
    expect(addFavorite).toHaveBeenCalledWith({ symbol: "AAPL", name: "Apple", currency: "USD" });
    expect(upsertStockDirectory).toHaveBeenCalledWith([
      { symbol: "AAPL", name: "Apple", currency: "USD" },
    ]);
  });

  it("does not seed the directory when no name is given", async () => {
    addFavorite.mockReturnValue({ symbol: "005930", name: null, currency: null });
    const res = await POST(postRequest({ symbol: "005930" }));
    expect(res.status).toBe(200);
    expect(upsertStockDirectory).not.toHaveBeenCalled();
  });
});

describe("favorites route — DELETE", () => {
  it("returns 400 when the symbol query parameter is missing", async () => {
    const res = await DELETE(deleteRequest(null));
    expect(res.status).toBe(400);
    expect(removeFavorite).not.toHaveBeenCalled();
  });

  it("returns 400 for a symbol with characters outside the allowed pattern", async () => {
    const res = await DELETE(deleteRequest("AB CD"));
    expect(res.status).toBe(400);
    expect(removeFavorite).not.toHaveBeenCalled();
  });

  it("removes a valid symbol", async () => {
    const res = await DELETE(deleteRequest("AAPL"));
    expect(res.status).toBe(200);
    expect(removeFavorite).toHaveBeenCalledWith("AAPL");
  });
});
