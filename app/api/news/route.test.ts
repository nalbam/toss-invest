import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsItem } from "@/lib/server/news/types";

const { getServerNewsSearch } = vi.hoisted(() => ({
  getServerNewsSearch: vi.fn(),
}));

vi.mock("@/lib/server/news/container", () => ({ getServerNewsSearch }));

// Plain function (not vi.fn) so the per-test `vi.clearAllMocks()` never wipes it
// and the route sees an authenticated session under `withAuth`.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "test" } }) } },
}));

import { GET } from "./route";

function newsRequest(params: Record<string, string>) {
  const url = new URL("http://test/api/news");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("news route", () => {
  it("returns 400 when the symbol query parameter is missing", async () => {
    const res = await GET(newsRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a symbol with characters outside the allowed pattern", async () => {
    const res = await GET(newsRequest({ symbol: "AB CD" }));
    expect(res.status).toBe(400);
  });

  it("returns an empty list (200) when no news search is configured", async () => {
    getServerNewsSearch.mockReturnValue(null);
    const res = await GET(newsRequest({ symbol: "AAPL" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: [] });
  });

  it("returns an empty list (200), not an error, when the upstream search throws", async () => {
    getServerNewsSearch.mockReturnValue(vi.fn().mockRejectedValue(new Error("boom")));
    const res = await GET(newsRequest({ symbol: "AAPL" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: [] });
  });

  it("queries by name when given, falling back to symbol otherwise", async () => {
    const items: NewsItem[] = [{ title: "t", url: "https://e.com/1", content: "" }];
    const search = vi.fn().mockResolvedValue(items);
    getServerNewsSearch.mockReturnValue(search);

    const res = await GET(newsRequest({ symbol: "005930", name: "삼성전자" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: items });
    expect(search).toHaveBeenCalledWith({
      query: "삼성전자",
      symbol: "005930",
      name: "삼성전자",
    });
  });
});
