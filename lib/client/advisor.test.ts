import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ApiClientError } from "./hooks";
import { fetchAdvisor, fetchLatestAdvisorResult } from "./advisor";

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const data = {
  advice: "조언",
  proposals: [
    {
      proposal: { kind: "trim", symbol: "005930", side: "SELL", quantity: 5, rationale: "r" },
      valid: true,
      reasons: [],
    },
  ],
  model: "stub-model",
  generatedAt: "2026-06-19T00:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAdvisor", () => {
  it("POSTs to /api/advisor and returns the unwrapped data", async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse({ data }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdvisor();
    expect(result.advice).toBe("조언");
    expect(result.proposals[0].valid).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/advisor");
    expect(init?.method).toBe("POST");
  });

  it("includes accountSeq in the query when provided", async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse({ data }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdvisor(42);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/advisor?accountSeq=42");
  });

  it("throws ApiClientError carrying the not-configured code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "advisor-not-configured", message: "nope" } }, 503),
      ),
    );

    await expect(fetchAdvisor()).rejects.toBeInstanceOf(ApiClientError);
    await expect(fetchAdvisor()).rejects.toMatchObject({ code: "advisor-not-configured" });
  });

  it("throws ApiClientError on a non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    await expect(fetchAdvisor()).rejects.toBeInstanceOf(ApiClientError);
  });

  it("throws ApiClientError on a non-ok response without an error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ unexpected: true }, 500)));
    await expect(fetchAdvisor()).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("fetchLatestAdvisorResult", () => {
  it("GETs the history and maps the newest event to an AdvisorResult", async () => {
    const event = { ...data, accountSeq: 7, cachedAt: "2026-06-19T00:00:01Z" };
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse({ data: { events: [event] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLatestAdvisorResult(7);
    expect(result).toEqual(data);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/advisor/history?limit=1&accountSeq=7");
    expect(init?.method).toBeUndefined();
  });

  it("omits accountSeq from the query when not provided", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse({ data: { events: [] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchLatestAdvisorResult();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/advisor/history?limit=1");
  });

  it("resolves null when no advice has been recorded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: { events: [] } })),
    );
    await expect(fetchLatestAdvisorResult()).resolves.toBeNull();
  });

  it("throws ApiClientError on an error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "invalid-request", message: "bad" } }, 400),
      ),
    );
    await expect(fetchLatestAdvisorResult()).rejects.toBeInstanceOf(ApiClientError);
  });
});
