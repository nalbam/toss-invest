import { z } from "zod";
import { NextResponse } from "next/server";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";
import { getServerLlmProvider, LlmNotConfiguredError } from "@/lib/server/llm/container";
import { AdvisorResponseError, runAdvisor } from "@/lib/server/advisor/advisor";
import { buildAdvisorSnapshot } from "@/lib/server/advisor/snapshot";
import type { ValidationContext } from "@/lib/server/advisor/validate";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
});

/**
 * POST so the (paid, external) LLM call is an explicit, non-idempotent action.
 * Collects the portfolio/market data, masks it into a snapshot, asks the
 * configured LLM for advice + proposals, then re-validates every proposal
 * against reality. The LLM is strictly upstream of §6 — this route never places
 * an order; it returns proposals (flagged valid/invalid) for the user to review.
 */
export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid accountSeq query parameter");
  }

  try {
    const client = getServerTossClient();

    let accountSeq = parsed.data.accountSeq;
    if (accountSeq === undefined) {
      const accounts = await client.getAccounts();
      const first = accounts[0];
      if (!first) {
        return invalidRequest("No account available to resolve accountSeq");
      }
      accountSeq = first.accountSeq;
    }

    const holdings = await client.getHoldings({ accountSeq });
    const buyingPower = await client.getBuyingPower({ accountSeq, currency: "KRW" });

    const hasUsd = holdings.items.some((item) => item.currency === "USD");
    const exchangeRate = hasUsd
      ? await client.getExchangeRate({ baseCurrency: "USD", quoteCurrency: "KRW" })
      : null;

    // Per-symbol sellable quantity feeds the SELL validation (§6.A-3). Held
    // symbols double as the known-tradable set; BUY proposals for unverified
    // symbols therefore fail validation (fail-closed, §6.A-4).
    const sellable = await Promise.all(
      holdings.items.map(async (item) => {
        const result = await client.getSellableQuantity({ accountSeq, symbol: item.symbol });
        return { symbol: item.symbol, sellableQuantity: Number(result.sellableQuantity) };
      }),
    );
    const validation: ValidationContext = {
      holdings: sellable,
      knownSymbols: new Set(holdings.items.map((item) => item.symbol)),
    };

    const snapshot = buildAdvisorSnapshot({ holdings, buyingPower, exchangeRate });
    const provider = getServerLlmProvider();
    const result = await runAdvisor({ provider, snapshot, validation });

    return ok({
      advice: result.advice,
      proposals: result.proposals,
      model: result.model,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return NextResponse.json(
        { error: { code: "advisor-not-configured", message: "AI advisor is not configured" } },
        { status: 503 },
      );
    }
    if (error instanceof AdvisorResponseError) {
      return NextResponse.json(
        { error: { code: "advisor-response-invalid", message: "The AI advisor returned an unusable response" } },
        { status: 502 },
      );
    }
    return handleError(error);
  }
}
