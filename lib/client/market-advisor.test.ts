import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ApiClientError } from "./hooks";
import { fetchMarketAdvisor, type MarketAdvisorInput } from "./market-advisor";

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const input: MarketAdvisorInput = {
  symbol: "005930",
  name: "삼성전자",
  interval: "1d",
  currency: "KRW",
  lastPrice: "72000",
  candles: [],
};

const data = {
  advice: "상승 추세입니다.",
  decision: {
    action: "buy",
    label: "매수 검토",
    reason: "지지선 위에서 반등 흐름이 확인됩니다.",
  },
  annotations: {
    supportLevels: [{ price: 68000, label: "지지 가능 구간" }],
    resistanceLevels: [{ price: 72000, label: "저항 확인 구간" }],
    markers: [],
  },
  model: "stub-model",
  generatedAt: "2026-06-19T00:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchMarketAdvisor", () => {
  it("POSTs market context and returns the unwrapped data", async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse({ data }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMarketAdvisor(input);

    expect(result.advice).toBe("상승 추세입니다.");
    expect(result.decision.action).toBe("buy");
    expect(result.annotations.supportLevels[0].price).toBe(68000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/market-advisor");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      symbol: "005930",
      interval: "1d",
    });
  });

  it("throws ApiClientError for an error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "advisor-not-configured", message: "nope" } }, 503),
      ),
    );

    await expect(fetchMarketAdvisor(input)).rejects.toBeInstanceOf(ApiClientError);
    await expect(fetchMarketAdvisor(input)).rejects.toMatchObject({
      code: "advisor-not-configured",
    });
  });
});
