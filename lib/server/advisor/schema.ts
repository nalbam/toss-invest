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

export const advisorProposalSchema = z.object({
  kind: proposalKindSchema,
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  rationale: z.string().min(1),
});

export const advisorResultSchema = z.object({
  advice: z.string().min(1),
  proposals: z.array(advisorProposalSchema),
});

export type ProposalKind = z.infer<typeof proposalKindSchema>;
export type AdvisorProposal = z.infer<typeof advisorProposalSchema>;
export type AdvisorResult = z.infer<typeof advisorResultSchema>;
