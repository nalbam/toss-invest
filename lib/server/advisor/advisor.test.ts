import { describe, expect, it, vi } from "vitest";
import { AdvisorResponseError, runAdvisor } from "./advisor";
import type { AdvisorSnapshot } from "./snapshot";
import type { ValidationContext } from "./validate";
import type { ChatRequest, ChatResponse, LlmProvider } from "@/lib/server/llm/types";

const snapshot: AdvisorSnapshot = {
  holdings: [
    {
      symbol: "005930",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      quantity: "10",
      lastPrice: "700",
      averagePurchasePrice: "650",
      marketValue: "7000",
      profitLoss: "500",
      profitLossRate: "0.077",
      weightPercent: 100,
    },
  ],
  cash: { currency: "KRW", buyingPower: "1000000" },
  exchangeRate: null,
};

const validation: ValidationContext = {
  holdings: [{ symbol: "005930", sellableQuantity: 10 }],
  knownSymbols: new Set(["005930", "000660"]),
};

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
  advice: "삼성전자 비중이 100%입니다. 분산을 고려하세요.",
  proposals: [
    { kind: "trim", symbol: "005930", side: "SELL", quantity: 5, rationale: "비중 축소" },
  ],
});

describe("runAdvisor", () => {
  it("returns advice, validated proposals, and the model on a valid response", async () => {
    const { provider } = stubProvider(validOutput);
    const result = await runAdvisor({ provider, snapshot, validation });

    expect(result.advice).toContain("삼성전자");
    expect(result.model).toBe("stub-model");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].valid).toBe(true);
    expect(result.proposals[0].proposal.symbol).toBe("005930");
  });

  it("flags (does not drop) a hallucinated proposal that fails validation", async () => {
    const output = JSON.stringify({
      advice: "신규 매수 제안",
      proposals: [
        { kind: "buy", symbol: "ZZZZ", side: "BUY", quantity: 1, rationale: "환각 종목" },
        { kind: "trim", symbol: "005930", side: "SELL", quantity: 5, rationale: "ok" },
      ],
    });
    const { provider } = stubProvider(output);
    const result = await runAdvisor({ provider, snapshot, validation });

    expect(result.proposals.map((p) => p.valid)).toEqual([false, true]);
    expect(result.proposals[0].reasons.join(" ")).toMatch(/unknown|tradable/i);
  });

  it("throws AdvisorResponseError when the content is not valid JSON", async () => {
    const { provider } = stubProvider("not json at all");
    await expect(runAdvisor({ provider, snapshot, validation })).rejects.toBeInstanceOf(
      AdvisorResponseError,
    );
  });

  it("throws AdvisorResponseError when the JSON does not match the schema", async () => {
    const { provider } = stubProvider(JSON.stringify({ advice: "", proposals: "nope" }));
    await expect(runAdvisor({ provider, snapshot, validation })).rejects.toBeInstanceOf(
      AdvisorResponseError,
    );
  });

  it("sends the prompt and forwards a structured-output json schema to the provider", async () => {
    const { provider, calls } = stubProvider(validOutput);
    const jsonSchema = { name: "advice", schema: { type: "object" } };
    await runAdvisor({ provider, snapshot, validation, jsonSchema });

    expect(calls).toHaveLength(1);
    expect(calls[0].jsonSchema).toEqual(jsonSchema);
    expect(calls[0].messages[0].role).toBe("system");
    expect(calls[0].messages[1].content).toContain("005930");
  });

  const buyNewSymbol = JSON.stringify({
    advice: "신규 매수 검토",
    proposals: [{ kind: "buy", symbol: "035720", side: "BUY", quantity: 1, rationale: "신규" }],
  });

  it("verifies a non-held BUY symbol and accepts it when verifySymbol confirms it", async () => {
    const { provider } = stubProvider(buyNewSymbol);
    const verifySymbol = vi.fn(async () => true);
    const result = await runAdvisor({ provider, snapshot, validation, verifySymbol });

    expect(verifySymbol).toHaveBeenCalledWith("035720");
    expect(result.proposals[0].valid).toBe(true);
  });

  it("keeps a non-held BUY symbol rejected when verifySymbol denies it (fail-closed)", async () => {
    const { provider } = stubProvider(buyNewSymbol);
    const verifySymbol = vi.fn(async () => false);
    const result = await runAdvisor({ provider, snapshot, validation, verifySymbol });

    expect(result.proposals[0].valid).toBe(false);
    expect(result.proposals[0].reasons.join(" ")).toMatch(/unknown|tradable/i);
  });

  it("treats a verifySymbol error as not-verified (fail-closed)", async () => {
    const { provider } = stubProvider(buyNewSymbol);
    const verifySymbol = vi.fn(async () => {
      throw new Error("toss down");
    });
    const result = await runAdvisor({ provider, snapshot, validation, verifySymbol });

    expect(result.proposals[0].valid).toBe(false);
  });

  it("does not verify already-held symbols (no extra lookups)", async () => {
    const { provider } = stubProvider(validOutput);
    const verifySymbol = vi.fn(async () => true);
    await runAdvisor({ provider, snapshot, validation, verifySymbol });

    expect(verifySymbol).not.toHaveBeenCalled();
  });
});
