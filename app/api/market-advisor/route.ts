import { NextResponse } from "next/server";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { recordMarketAdvice } from "@/lib/server/market-advisor/history";
import { getServerLlmProvider, LlmNotConfiguredError } from "@/lib/server/llm/container";
import {
  marketAdvisorJsonSchema,
  marketAdvisorRequestSchema,
} from "@/lib/server/market-advisor/schema";
import {
  MarketAdvisorResponseError,
  runMarketAdvisor,
} from "@/lib/server/market-advisor/market-advisor";
import { latestCandleTimestamp } from "@/lib/server/market-advisor/timestamp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST so the (paid, external) LLM call is an explicit, non-idempotent action.
 * Asks the configured LLM to analyze the supplied chart data and returns advice +
 * a reference decision + chart annotations (re-validated against a zod schema).
 * Best-effort records the advice to history; never blocks on the cache.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsed = marketAdvisorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid market advisor request body");
  }

  try {
    const provider = getServerLlmProvider();
    const result = await runMarketAdvisor({
      provider,
      request: parsed.data,
      jsonSchema: marketAdvisorJsonSchema,
    });
    const generatedAt = new Date().toISOString();
    void recordMarketAdvice({
      symbol: parsed.data.symbol,
      interval: parsed.data.interval,
      generatedAt,
      chartTimestamp: latestCandleTimestamp(parsed.data),
      chartFrom: parsed.data.candles[0]?.timestamp ?? null,
      candleCount: parsed.data.candles.length,
      lastPrice: parsed.data.lastPrice,
      decision: result.decision,
      advice: result.advice,
      annotations: result.annotations,
    });

    return ok({
      advice: result.advice,
      decision: result.decision,
      annotations: result.annotations,
      model: result.model,
      generatedAt,
    });
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return NextResponse.json(
        { error: { code: "advisor-not-configured", message: "AI advisor is not configured" } },
        { status: 503 },
      );
    }
    if (error instanceof Error && error.message.includes("chat request failed")) {
      return NextResponse.json(
        { error: { code: "market-advisor-failed", message: "AI market advisor request failed" } },
        { status: 502 },
      );
    }
    if (error instanceof MarketAdvisorResponseError) {
      return NextResponse.json(
        { error: { code: "market-advisor-response-invalid", message: "AI market advisor response is invalid" } },
        { status: 502 },
      );
    }
    return handleError(error);
  }
}
