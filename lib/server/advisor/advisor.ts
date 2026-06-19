import "server-only";
import type { JsonSchemaSpec, LlmProvider } from "@/lib/server/llm/types";
import { buildAdvisorPrompt } from "./prompt";
import { advisorResultSchema } from "./schema";
import type { AdvisorSnapshot } from "./snapshot";
import { validateProposals, type ValidatedProposal, type ValidationContext } from "./validate";

// Orchestrates one advisor run: snapshot -> prompt -> provider -> zod parse ->
// validate -> result. The provider is injected (the only non-deterministic part)
// so the whole flow is testable with a stub. The provider response is an
// untrusted boundary: it is JSON-parsed + zod-validated (parse failure -> a
// typed error), then every proposal is checked against reality and flagged
// (invalid proposals are kept-but-flagged, never silently dropped or executed).

/** Raised when the LLM response is not parseable JSON or does not match the schema. */
export class AdvisorResponseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AdvisorResponseError";
  }
}

export interface RunAdvisorDeps {
  provider: LlmProvider;
  snapshot: AdvisorSnapshot;
  validation: ValidationContext;
  /** Optional provider-native structured-output schema (response_format). */
  jsonSchema?: JsonSchemaSpec;
}

export interface AdvisorRunResult {
  advice: string;
  proposals: ValidatedProposal[];
  model: string;
}

export async function runAdvisor(deps: RunAdvisorDeps): Promise<AdvisorRunResult> {
  const messages = buildAdvisorPrompt(deps.snapshot);
  const response = await deps.provider.chat({ messages, jsonSchema: deps.jsonSchema });

  let raw: unknown;
  try {
    raw = JSON.parse(response.content);
  } catch (error) {
    throw new AdvisorResponseError("LLM response is not valid JSON", { cause: error });
  }

  const parsed = advisorResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AdvisorResponseError("LLM response does not match the advisor schema", {
      cause: parsed.error,
    });
  }

  const proposals = validateProposals(parsed.data.proposals, deps.validation);
  return { advice: parsed.data.advice, proposals, model: response.model };
}
