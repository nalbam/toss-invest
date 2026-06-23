import "server-only";
import type { JsonSchemaSpec, LlmProvider } from "@/lib/server/llm/types";
import { buildMarketAdvisorPrompt } from "./prompt";
import {
  marketAdvisorResultSchema,
  type MarketAdvisorRequest,
  type MarketAdvisorResult,
} from "./schema";

// Orchestrates one market advisor run: prompt -> provider -> zod parse -> result.
// The provider is injected (the only non-deterministic part) so the whole flow is
// testable with a stub. The provider response is an untrusted boundary: it is
// JSON-parsed + zod-validated (parse failure -> a typed error) before use.
// Mirrors lib/server/advisor/advisor.ts.

/** Raised when the LLM response is not parseable JSON or does not match the schema. */
export class MarketAdvisorResponseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MarketAdvisorResponseError";
  }
}

export interface RunMarketAdvisorDeps {
  provider: LlmProvider;
  request: MarketAdvisorRequest;
  /** Optional provider-native structured-output schema (response_format). */
  jsonSchema?: JsonSchemaSpec;
}

export interface MarketAdvisorRunResult {
  advice: string;
  decision: MarketAdvisorResult["decision"];
  annotations: MarketAdvisorResult["annotations"];
  model: string;
}

export async function runMarketAdvisor(
  deps: RunMarketAdvisorDeps,
): Promise<MarketAdvisorRunResult> {
  const messages = buildMarketAdvisorPrompt(deps.request);
  const response = await deps.provider.chat({ messages, jsonSchema: deps.jsonSchema });

  let raw: unknown;
  try {
    raw = JSON.parse(response.content);
  } catch (error) {
    throw new MarketAdvisorResponseError("LLM response is not valid JSON", { cause: error });
  }

  const parsed = marketAdvisorResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MarketAdvisorResponseError(
      "LLM response does not match the market advisor schema",
      { cause: parsed.error },
    );
  }

  return {
    advice: parsed.data.advice.trim(),
    decision: parsed.data.decision,
    annotations: parsed.data.annotations,
    model: response.model,
  };
}
