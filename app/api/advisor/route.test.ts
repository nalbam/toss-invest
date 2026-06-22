import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest, ChatResponse, LlmProvider } from "@/lib/server/llm/types";

// Toss facade + LLM provider container are mocked; the snapshot/prompt/validate
// pipeline and runAdvisor run for real so this is a vertical slice of the route.
const facade = {
  getAccounts: vi.fn(),
  getHoldings: vi.fn(),
  getBuyingPower: vi.fn(),
  getExchangeRate: vi.fn(),
  getSellableQuantity: vi.fn(),
  getStocks: vi.fn(),
};

const { getServerLlmProvider } = vi.hoisted(() => ({ getServerLlmProvider: vi.fn() }));

vi.mock("@/lib/server/toss/container", () => ({
  getServerTossClient: () => facade,
}));

vi.mock("@/lib/server/llm/container", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/llm/container")>();
  return { ...actual, getServerLlmProvider };
});

import { POST } from "@/app/api/advisor/route";
import { LlmNotConfiguredError } from "@/lib/server/llm/container";

const ACCOUNT_SEQ = 1;

function holdingsOverview() {
  return {
    totalPurchaseAmount: { krw: "6500", usd: null },
    marketValue: {
      amount: { krw: "7000", usd: null },
      amountAfterCost: { krw: "6970", usd: null },
    },
    profitLoss: {
      amount: { krw: "500", usd: null },
      amountAfterCost: { krw: "470", usd: null },
      rate: "0.077",
      rateAfterCost: "0.07",
    },
    dailyProfitLoss: { amount: { krw: "30", usd: null }, rate: "0.004" },
    items: [
      {
        symbol: "005930",
        name: "삼성전자",
        marketCountry: "KR",
        currency: "KRW",
        quantity: "10",
        lastPrice: "700",
        averagePurchasePrice: "650",
        marketValue: { purchaseAmount: "6500", amount: "7000", amountAfterCost: "6970" },
        profitLoss: { amount: "500", amountAfterCost: "470", rate: "0.077", rateAfterCost: "0.07" },
        dailyProfitLoss: { amount: "30", rate: "0.004" },
        cost: { commission: "5", tax: null },
      },
    ],
  };
}

function stubProvider(content: string) {
  const calls: ChatRequest[] = [];
  const provider: LlmProvider = {
    name: "openai",
    chat: vi.fn(async (request: ChatRequest): Promise<ChatResponse> => {
      calls.push(request);
      return { content, model: "stub-model" };
    }),
  };
  return { provider, calls };
}

const validOutput = JSON.stringify({
  advice: "삼성전자 비중이 높습니다.",
  proposals: [
    { kind: "trim", symbol: "005930", side: "SELL", quantity: 5, rationale: "비중 축소" },
  ],
});

function postReq(): Request {
  return new Request(`http://localhost/api/advisor?accountSeq=${ACCOUNT_SEQ}`, {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  facade.getHoldings.mockResolvedValue(holdingsOverview());
  facade.getBuyingPower.mockResolvedValue({ currency: "KRW", cashBuyingPower: "1000000" });
  facade.getSellableQuantity.mockResolvedValue({ sellableQuantity: "10" });
  facade.getStocks.mockResolvedValue([]);
});

describe("POST /api/advisor", () => {
  it("returns advice + validated proposals in a { data } envelope", async () => {
    const { provider } = stubProvider(validOutput);
    getServerLlmProvider.mockReturnValue(provider);

    const response = await POST(postReq());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.advice).toContain("삼성전자");
    expect(body.data.model).toBe("stub-model");
    expect(typeof body.data.generatedAt).toBe("string");
    expect(body.data.proposals).toHaveLength(1);
    expect(body.data.proposals[0].valid).toBe(true);
  });

  it("flags a hallucinated proposal as invalid (kept, not executed)", async () => {
    const output = JSON.stringify({
      advice: "신규 매수",
      proposals: [{ kind: "buy", symbol: "ZZZZ", side: "BUY", quantity: 1, rationale: "환각" }],
    });
    const { provider } = stubProvider(output);
    getServerLlmProvider.mockReturnValue(provider);

    const response = await POST(postReq());
    const body = await response.json();
    expect(body.data.proposals[0].valid).toBe(false);
  });

  it("maps LlmNotConfiguredError to a not-configured response", async () => {
    getServerLlmProvider.mockImplementation(() => {
      throw new LlmNotConfiguredError("LLM_PROVIDER is not set");
    });

    const response = await POST(postReq());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("advisor-not-configured");
  });

  it("maps an invalid LLM response to a sanitized error", async () => {
    const { provider } = stubProvider("not json at all");
    getServerLlmProvider.mockReturnValue(provider);

    const response = await POST(postReq());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("advisor-response-invalid");
  });

  it("never sends account identifiers in the prompt payload", async () => {
    const { provider, calls } = stubProvider(validOutput);
    getServerLlmProvider.mockReturnValue(provider);

    await POST(postReq());
    const serialized = JSON.stringify(calls);
    for (const forbidden of ["accountNo", "accountSeq", "accountType"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("resolves accountSeq from the first account when not provided", async () => {
    facade.getAccounts.mockResolvedValue([{ accountNo: "x", accountSeq: 42, accountType: "PENSION" }]);
    const { provider } = stubProvider(validOutput);
    getServerLlmProvider.mockReturnValue(provider);

    const response = await POST(new Request("http://localhost/api/advisor", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(facade.getHoldings).toHaveBeenCalledWith(expect.objectContaining({ accountSeq: 42 }));
  });

  it("forwards a structured-output json schema to the provider", async () => {
    const { provider, calls } = stubProvider(validOutput);
    getServerLlmProvider.mockReturnValue(provider);

    await POST(postReq());
    expect(calls).toHaveLength(1);
    expect(calls[0].jsonSchema?.name).toBe("portfolio_advice");
    expect(calls[0].jsonSchema?.schema).toMatchObject({
      type: "object",
      properties: { advice: { type: "string" }, proposals: { type: "array" } },
    });
  });

  const buyNewSymbol = JSON.stringify({
    advice: "신규 매수 검토",
    proposals: [{ kind: "buy", symbol: "035720", side: "BUY", quantity: 1, rationale: "신규" }],
  });

  it("verifies a non-held BUY symbol via Toss and accepts it when it exists", async () => {
    const { provider } = stubProvider(buyNewSymbol);
    getServerLlmProvider.mockReturnValue(provider);
    facade.getStocks.mockResolvedValue([{ symbol: "035720" }]);

    const response = await POST(postReq());
    const body = await response.json();
    expect(facade.getStocks).toHaveBeenCalledWith({ symbols: ["035720"] });
    expect(body.data.proposals[0].valid).toBe(true);
  });

  it("rejects a non-held BUY symbol that Toss does not return (fail-closed)", async () => {
    const { provider } = stubProvider(buyNewSymbol);
    getServerLlmProvider.mockReturnValue(provider);
    facade.getStocks.mockResolvedValue([]);

    const response = await POST(postReq());
    const body = await response.json();
    expect(body.data.proposals[0].valid).toBe(false);
  });
});
