import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ApiClientError } from "./hooks";
import {
  fetchMarketAdvisor,
  loadAdvisorCandles,
  type MarketAdvisorInput,
} from "./market-advisor";

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

describe("loadAdvisorCandles", () => {
  function candle1m(ms: number) {
    return {
      timestamp: new Date(ms).toISOString(),
      openPrice: "100",
      highPrice: "110",
      lowPrice: "90",
      closePrice: "105",
      volume: "10",
      currency: "KRW",
    };
  }

  /** A fetch stub that pages back through `all` (ascending) 200-at-a-time,
   *  newest-first, honoring the `before` cursor — like Toss `/api/v1/candles`. */
  function pagedCandleFetch(all: ReturnType<typeof candle1m>[]): FetchMock {
    return vi.fn(async (url: string) => {
      const u = new URL(url, "http://localhost");
      const before = u.searchParams.get("before");
      const cutoff = before === null ? Infinity : Date.parse(before);
      const older = all.filter((c) => Date.parse(c.timestamp) < cutoff);
      const page = older.slice(-200).reverse(); // up to 200, newest-first
      const nextBefore =
        older.length > 200 ? page[page.length - 1].timestamp : null;
      return jsonResponse({ data: { candles: page, nextBefore } });
    });
  }

  it("aggregates 1m source into the SELECTED interval (10m → 200 ten-minute bars, not 200 one-minute candles)", async () => {
    const base = Date.parse("2026-06-19T00:00:00Z");
    const all = Array.from({ length: 2000 }, (_, i) => candle1m(base + i * 60_000));
    const fetchMock = pagedCandleFetch(all);
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadAdvisorCandles("005930", "10m");

    // Every source request uses the 1m source interval (aggregation is client-side).
    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(url, "http://localhost").searchParams.get("interval")).toBe(
        "1m",
      );
    }
    // It paginated to gather ~2000 one-minute candles (not one 200 page).
    expect(fetchMock.mock.calls.length).toBe(10);
    // 2000 one-minute candles → 200 TEN-MINUTE bars.
    expect(result).toHaveLength(200);
    // Consecutive bars are 10 minutes apart — proving real aggregation, not raw 1m.
    expect(
      Date.parse(result[1].timestamp) - Date.parse(result[0].timestamp),
    ).toBe(10 * 60_000);
  });

  it("returns 1:1 one-minute bars for a 1m chart (single page, no aggregation)", async () => {
    const base = Date.parse("2026-06-19T00:00:00Z");
    const all = Array.from({ length: 200 }, (_, i) => candle1m(base + i * 60_000));
    vi.stubGlobal("fetch", pagedCandleFetch(all));

    const result = await loadAdvisorCandles("005930", "1m");

    expect(result).toHaveLength(200);
    // 1m bars are one minute apart.
    expect(
      Date.parse(result[1].timestamp) - Date.parse(result[0].timestamp),
    ).toBe(60_000);
  });
});
