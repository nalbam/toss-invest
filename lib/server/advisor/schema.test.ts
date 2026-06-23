import { describe, expect, it } from "vitest";
import { advisorResultSchema } from "./schema";

const validProposal = {
  kind: "trim",
  symbol: "005930",
  side: "SELL",
  quantity: 5,
  rationale: "비중이 과도해 일부 차익 실현",
};

const validResult = {
  advice: "삼성전자 비중이 높습니다. 일부 트림을 고려하세요.",
  proposals: [validProposal],
};

describe("advisorResultSchema", () => {
  it("parses a valid advisor result", () => {
    const parsed = advisorResultSchema.parse(validResult);
    expect(parsed.advice).toContain("삼성전자");
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]).toEqual(validProposal);
  });

  it("accepts an empty proposals array (advice-only / hold everything)", () => {
    const parsed = advisorResultSchema.parse({ advice: "현 상태 유지 권장.", proposals: [] });
    expect(parsed.proposals).toEqual([]);
  });

  it("strips unknown extra fields from the LLM output", () => {
    const result = advisorResultSchema.safeParse({
      ...validResult,
      hallucinatedField: "ignore me",
      proposals: [{ ...validProposal, confidence: 0.9 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("hallucinatedField");
      expect(result.data.proposals[0]).not.toHaveProperty("confidence");
    }
  });

  it("rejects a non-integer quantity", () => {
    const result = advisorResultSchema.safeParse({
      advice: "x",
      proposals: [{ ...validProposal, quantity: 1.5 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive quantity", () => {
    for (const quantity of [0, -3]) {
      const result = advisorResultSchema.safeParse({
        advice: "x",
        proposals: [{ ...validProposal, quantity }],
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects an unknown side", () => {
    const result = advisorResultSchema.safeParse({
      advice: "x",
      proposals: [{ ...validProposal, side: "HOLD" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const result = advisorResultSchema.safeParse({
      advice: "x",
      proposals: [{ ...validProposal, kind: "yolo" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank symbol", () => {
    const result = advisorResultSchema.safeParse({
      advice: "x",
      proposals: [{ ...validProposal, symbol: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing advice", () => {
    const result = advisorResultSchema.safeParse({ proposals: [] });
    expect(result.success).toBe(false);
  });
});
