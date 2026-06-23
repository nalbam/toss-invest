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
   * Resolves a proposed BUY symbol against Toss when it is NOT already a known
   * (held) symbol. A non-null result both verifies the symbol exists/tradable
   * (loosening the §6.A-4 gate for that symbol) and supplies its display name.
   * Consulted only for non-held BUY proposals. Omitted, a null return, or a
   * throw all keep the symbol rejected (fail-closed) and nameless — the gate is
   * only ever loosened by an explicit, successful resolution.
   */
  resolveSymbol?: (symbol: string) => Promise<{ name: string } | null>;
}

/**
 * Resolves non-held BUY symbols against Toss in one pass: a non-null result adds
 * the symbol to `knownSymbols` (so its proposal can validate) and records its
 * display name. SELL/held symbols are untouched (SELL is still gated by the
 * holdings check). Any resolution failure leaves the symbol unknown and nameless
 * (fail-closed).
 */
async function resolveSymbols(
  proposals: AdvisorProposal[],
  deps: RunAdvisorDeps,
): Promise<{ context: ValidationContext; names: Map<string, string> }> {
  const names = new Map<string, string>();
  const resolve = deps.resolveSymbol;
  if (resolve === undefined) {
    return { context: deps.validation, names };
  }
  const candidates = [
    ...new Set(
      proposals
        .filter((p) => p.side === "BUY" && !deps.validation.knownSymbols.has(p.symbol))
        .map((p) => p.symbol),
    ),
  ];
  if (candidates.length === 0) {
    return { context: deps.validation, names };
  }
  const resolved = await Promise.all(
    candidates.map(async (symbol) => {
      try {
        return { symbol, info: await resolve(symbol) };
      } catch {
        return { symbol, info: null };
      }
    }),
  );
  const verified: string[] = [];
  for (const { symbol, info } of resolved) {
    if (info !== null) {
      verified.push(symbol);
      names.set(symbol, info.name);
    }
  }
  if (verified.length === 0) {
    return { context: deps.validation, names };
  }
  return {
    context: {
      ...deps.validation,
      knownSymbols: new Set([...deps.validation.knownSymbols, ...verified]),
    },
    names,
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

  const { context, names } = await resolveSymbols(parsed.data.proposals, deps);
  const validated = validateProposals(parsed.data.proposals, context);
  const proposals = validated.map((item) => {
    const name = names.get(item.proposal.symbol);
    return name === undefined ? item : { ...item, name };
  });
  return { advice: parsed.data.advice, proposals, model: response.model };
}
