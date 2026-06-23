import "server-only";
import type { AdvisorProposal } from "./schema";

// Deterministic validation of LLM proposals against reality (§6.A-3/4). The LLM
// is an untrusted, hallucination-prone source: a proposal may name a symbol that
// does not exist, oversell a position, or pair an incoherent kind/side. This
// layer REJECTS such proposals (it never auto-corrects/clamps) so only sound
// proposals can later be prefilled into the order form. It is pure — the caller
// injects the reality context gathered from Toss.

export interface HoldingPosition {
  symbol: string;
  sellableQuantity: number;
}

export interface ValidationContext {
  /** Current holdings with their sellable quantity (for SELL checks). */
  holdings: HoldingPosition[];
  /** Symbols confirmed to exist and be tradable (via Toss). */
  knownSymbols: ReadonlySet<string>;
}

export interface ValidatedProposal {
  proposal: AdvisorProposal;
  valid: boolean;
  /** Why the proposal was rejected; empty when valid. */
  reasons: string[];
  /**
   * Display name resolved from reality (Toss) for a symbol the dashboard does
   * not already know from holdings — i.e. a non-held proposed symbol. Undefined
   * for held symbols (the dashboard resolves those from its own holdings) or
   * when no name could be resolved.
   */
  name?: string;
}

/** kind→required side (rebalance may go either way). */
function kindSideConflict(proposal: AdvisorProposal): boolean {
  switch (proposal.kind) {
    case "buy":
      return proposal.side !== "BUY";
    case "trim":
    case "exit":
      return proposal.side !== "SELL";
    case "rebalance":
      return false;
  }
}

function validateOne(
  proposal: AdvisorProposal,
  context: ValidationContext,
): ValidatedProposal {
  const reasons: string[] = [];

  if (!Number.isInteger(proposal.quantity) || proposal.quantity <= 0) {
    reasons.push("quantity must be a positive integer");
  }

  if (kindSideConflict(proposal)) {
    reasons.push(`kind "${proposal.kind}" is incoherent with side "${proposal.side}"`);
  }

  if (!context.knownSymbols.has(proposal.symbol)) {
    reasons.push("unknown or non-tradable symbol");
  }

  if (proposal.side === "SELL") {
    const position = context.holdings.find((h) => h.symbol === proposal.symbol);
    if (!position) {
      reasons.push("symbol is not held, cannot sell");
    } else if (proposal.quantity > position.sellableQuantity) {
      reasons.push("quantity exceeds sellable quantity");
    }
  }

  return { proposal, valid: reasons.length === 0, reasons };
}

/**
 * Validates each proposal independently against the reality context. Returns one
 * result per input proposal (same order), flagging invalid ones with reasons
 * rather than dropping them — the UI shows invalid proposals but blocks prefill.
 */
export function validateProposals(
  proposals: AdvisorProposal[],
  context: ValidationContext,
): ValidatedProposal[] {
  return proposals.map((proposal) => validateOne(proposal, context));
}
