import "server-only";
import type { JsonSchemaSpec, LlmProvider } from "@/lib/server/llm/types";
import { buildAdvisorPrompt } from "./prompt";
import { advisorResultSchema, type AdvisorProposal } from "./schema";
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
  /**
   * Verifies that a proposed BUY symbol exists/tradable when it is NOT already a
   * known (held) symbol. Consulted only for non-held BUY proposals. Omitted, a
   * false return, or a throw all keep the symbol rejected (fail-closed, §6.A-4) —
   * the gate is only ever loosened by an explicit, successful verification.
   */
  verifySymbol?: (symbol: string) => Promise<boolean>;
}

/**
 * Augments the reality context by verifying non-held BUY symbols against Toss.
 * SELL/held symbols are untouched (SELL is still gated by the holdings check), so
 * only BUY proposals for symbols the user does not hold trigger a lookup. Any
 * verification failure leaves the symbol out of `knownSymbols` (fail-closed).
 */
async function resolveValidationContext(
  proposals: AdvisorProposal[],
  deps: RunAdvisorDeps,
): Promise<ValidationContext> {
  const verify = deps.verifySymbol;
  if (verify === undefined) {
    return deps.validation;
  }
  const candidates = [
    ...new Set(
      proposals
        .filter((p) => p.side === "BUY" && !deps.validation.knownSymbols.has(p.symbol))
        .map((p) => p.symbol),
    ),
  ];
  if (candidates.length === 0) {
    return deps.validation;
  }
  const checked = await Promise.all(
    candidates.map(async (symbol) => {
      try {
        return { symbol, ok: await verify(symbol) };
      } catch {
        return { symbol, ok: false };
      }
    }),
  );
  const verified = checked.filter((c) => c.ok).map((c) => c.symbol);
  if (verified.length === 0) {
    return deps.validation;
  }
  return {
    ...deps.validation,
    knownSymbols: new Set([...deps.validation.knownSymbols, ...verified]),
  };
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

  const context = await resolveValidationContext(parsed.data.proposals, deps);
  const proposals = validateProposals(parsed.data.proposals, context);
  return { advice: parsed.data.advice, proposals, model: response.model };
}
