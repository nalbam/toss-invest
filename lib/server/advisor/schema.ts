import "server-only";
import { z } from "zod";

// Structured output the advisor expects back from the LLM. The provider response
// is an untrusted boundary, so it is re-parsed with this zod schema before use
// (extra/hallucinated fields are stripped, not trusted). Cross-checks against
// real holdings/symbols happen later in validate.ts — this layer only enforces
// shape and basic field validity.

/**
 * Display label for a proposal. Order-actionable kinds (buy/trim/exit/rebalance)
 * carry a side + quantity and can be prefilled into the order form. "hold"
 * guidance is conveyed in `advice`, not as a proposal, since it is not an order.
 */
export const proposalKindSchema = z.enum(["buy", "trim", "exit", "rebalance"]);

// Mirrors the symbolPattern every API route already validates path/query
// symbols against (and lib/server/market-advisor/schema.ts) — without it, an
// LLM hallucination containing spaces/punctuation would still pass this shape
// check and reach the Toss lookup in resolveSymbol (§6.A-4) as a raw string.
const symbolPattern = /^[A-Za-z0-9.\-]+$/;

export const advisorProposalSchema = z.object({
  kind: proposalKindSchema,
  symbol: z.string().min(1).regex(symbolPattern),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  rationale: z.string().min(1),
});

export const advisorResultSchema = z.object({
  advice: z.string().min(1),
  proposals: z.array(advisorProposalSchema),
});

// Provider-native structured output mirroring advisorResultSchema. Improves the
// LLM's odds of returning well-formed JSON; the response is still re-parsed with
// the zod schema in runAdvisor, so this is reliability help, not a trust anchor.
export const advisorJsonSchema = {
  name: "portfolio_advice",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["advice", "proposals"],
    properties: {
      advice: { type: "string" },
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "symbol", "side", "quantity", "rationale"],
          properties: {
            kind: { type: "string", enum: ["buy", "trim", "exit", "rebalance"] },
            symbol: { type: "string" },
            side: { type: "string", enum: ["BUY", "SELL"] },
            quantity: { type: "integer" },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export type ProposalKind = z.infer<typeof proposalKindSchema>;
export type AdvisorProposal = z.infer<typeof advisorProposalSchema>;
export type AdvisorResult = z.infer<typeof advisorResultSchema>;
