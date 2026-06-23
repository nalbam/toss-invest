import { describe, expect, it, vi } from "vitest";
import type { ChatRequest, LlmProvider } from "@/lib/server/llm/types";
import { MarketAdvisorResponseError, runMarketAdvisor } from "./market-advisor";
import type { MarketAdvisorRequest } from "./schema";

const request: MarketAdvisorRequest = {
  symbol: "005930",
  interval: "1m",
  currency: "KRW",
  candles: [],
};

function stubProvider(content: string) {
  const calls: ChatRequest[] = [];
  const provider: LlmProvider = {
    name: "openai",
    chat: vi.fn(async (req: ChatRequest) => {
      calls.push(req);
      return { content, model: "stub-model" };
    }),
  };
  return { provider, calls };
}

const validOutput = JSON.stringify({
  advice: "  단기 반등 시도  ",
  decision: { action: "buy", label: "매수 검토", reason: "지지선 확인" },
  annotations: { supportLevels: [], resistanceLevels: [], markers: [] },
});

describe("runMarketAdvisor", () => {
  it("parses a valid provider response and trims advice", async () => {
    const { provider, calls } = stubProvider(validOutput);
    const result = await runMarketAdvisor({ provider, request });
    expect(result.advice).toBe("단기 반등 시도");
    expect(result.decision.action).toBe("buy");
    expect(result.model).toBe("stub-model");
    expect(calls).toHaveLength(1);
  });

  it("passes the json schema through to the provider", async () => {
    const { provider, calls } = stubProvider(validOutput);
    await runMarketAdvisor({
      provider,
      request,
      jsonSchema: { name: "market_advice", schema: {} },
    });
    expect(calls[0].jsonSchema).toEqual({ name: "market_advice", schema: {} });
  });

  it("throws MarketAdvisorResponseError on non-JSON content", async () => {
    const { provider } = stubProvider("not json");
    await expect(runMarketAdvisor({ provider, request })).rejects.toBeInstanceOf(
      MarketAdvisorResponseError,
    );
  });

  it("throws MarketAdvisorResponseError when the shape does not match", async () => {
    const { provider } = stubProvider(JSON.stringify({ advice: "x" }));
    await expect(runMarketAdvisor({ provider, request })).rejects.toBeInstanceOf(
      MarketAdvisorResponseError,
    );
  });
});
