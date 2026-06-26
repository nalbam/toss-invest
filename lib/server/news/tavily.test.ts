import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { createTavilyNewsSearch } from "./tavily";

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const okPayload = {
  query: "삼성전자",
  results: [
    {
      title: "삼성전자, 신규 HBM 공급 계약",
      url: "https://news.example.com/1",
      content: "삼성전자가 대형 고객사와 HBM 공급 계약을 체결했다.",
      score: 0.9,
      published_date: "2026-06-20",
    },
    {
      title: "반도체 업황 회복 조짐",
      url: "https://news.example.com/2",
      content: "메모리 가격이 반등하고 있다.",
      score: 0.8,
    },
  ],
};

function setup(response: Response) {
  const fetchFn: FetchMock = vi.fn(async () => response);
  const search = createTavilyNewsSearch({ apiKey: "tvly-SECRET", fetchFn });
  return { fetchFn, search };
}

function lastInit(fetchFn: FetchMock): RequestInit {
  return fetchFn.mock.calls[0][1];
}

function lastBody(fetchFn: FetchMock): Record<string, unknown> {
  return JSON.parse(lastInit(fetchFn).body as string);
}

describe("createTavilyNewsSearch", () => {
  it("POSTs to the tavily search endpoint with bearer auth and a general query", async () => {
    const { fetchFn, search } = setup(jsonResponse(okPayload));
    await search({ query: "삼성전자" });

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");

    const init = lastInit(fetchFn);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tvly-SECRET");
    expect(headers["content-type"]).toBe("application/json");

    const body = lastBody(fetchFn);
    expect(body.query).toBe("삼성전자");
    expect(body.topic).toBe("general");
  });

  it("maps results into NewsItem[] keeping title/url/content/publishedDate", async () => {
    const { search } = setup(jsonResponse(okPayload));
    const news = await search({ query: "삼성전자" });

    expect(news).toHaveLength(2);
    expect(news[0]).toEqual({
      title: "삼성전자, 신규 HBM 공급 계약",
      url: "https://news.example.com/1",
      content: "삼성전자가 대형 고객사와 HBM 공급 계약을 체결했다.",
      publishedDate: "2026-06-20",
    });
    // published_date absent → publishedDate undefined, not crash.
    expect(news[1].publishedDate).toBeUndefined();
  });

  it("drops malformed results (missing title/url) but keeps valid ones", async () => {
    const payload = {
      results: [
        { url: "https://news.example.com/x", content: "no title" },
        { title: "valid", url: "https://news.example.com/y", content: "ok" },
      ],
    };
    const { search } = setup(jsonResponse(payload));
    const news = await search({ query: "x" });
    expect(news).toHaveLength(1);
    expect(news[0].title).toBe("valid");
  });

  it("returns an empty array when the response has no results", async () => {
    const { search } = setup(jsonResponse({ query: "x" }));
    expect(await search({ query: "x" })).toEqual([]);
  });

  it("passes an abort signal (timeout cost guard)", async () => {
    const { fetchFn, search } = setup(jsonResponse(okPayload));
    await search({ query: "x" });
    expect(lastInit(fetchFn).signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx response without leaking the api key", async () => {
    const { search } = setup(jsonResponse({ error: "nope" }, 401));
    await expect(search({ query: "x" })).rejects.toThrow(/status 401/);
    await expect(search({ query: "x" })).rejects.not.toThrow(/tvly-SECRET/);
  });
});
