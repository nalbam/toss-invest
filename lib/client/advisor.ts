import { isErrorEnvelope, isSuccessEnvelope } from "./envelope";
import { ApiClientError } from "./hooks";

// Client-side types + on-demand fetcher for the AI advisor. The advisor is
// button-triggered only (a paid LLM call) — it is never auto-polled via SWR.
// These types mirror the route's `{ data }` payload.

export type ProposalKind = "buy" | "trim" | "exit" | "rebalance";
export type OrderSide = "BUY" | "SELL";

export interface AdvisorProposal {
  kind: ProposalKind;
  symbol: string;
  side: OrderSide;
  quantity: number;
  rationale: string;
}

export interface ValidatedProposal {
  proposal: AdvisorProposal;
  valid: boolean;
  reasons: string[];
  /** Display name for a non-held proposed symbol, resolved server-side from Toss. */
  name?: string;
}

export interface AdvisorResult {
  advice: string;
  proposals: ValidatedProposal[];
  model: string;
  generatedAt: string;
}

/**
 * Triggers one advisor run via `POST /api/advisor`. Resolves to the advice +
 * validated proposals, or throws `ApiClientError` ({ error } envelope, including
 * `advisor-not-configured`, or a non-JSON/unexpected failure).
 */
export async function fetchAdvisor(accountSeq?: number): Promise<AdvisorResult> {
  const url =
    accountSeq === undefined ? "/api/advisor" : `/api/advisor?accountSeq=${accountSeq}`;
  const res = await fetch(url, { method: "POST" });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unreadable response.",
      status: res.status,
    });
  }

  if (!res.ok || isErrorEnvelope(body)) {
    if (isErrorEnvelope(body)) {
      throw new ApiClientError({
        code: body.error.code,
        message: body.error.message,
        status: res.status,
        requestId: body.error.requestId,
      });
    }
    throw new ApiClientError({
      code: "unexpected-error",
      message: `Request failed with status ${res.status}.`,
      status: res.status,
    });
  }

  if (!isSuccessEnvelope<AdvisorResult>(body)) {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unexpected response shape.",
      status: res.status,
    });
  }
  return body.data;
}
