import { NextResponse } from "next/server";
import { invalidRequest, ok } from "@/lib/server/api/respond";
import { handleAdvisorError } from "@/lib/server/api/advisor-error";
import { withAuth } from "@/lib/server/auth/with-auth";
import {
  readMarketAdviceHistory,
  recordMarketAdvice,
} from "@/lib/server/market-advisor/history";
import { getServerLlmProvider } from "@/lib/server/llm/container";
import { getServerNewsSearch } from "@/lib/server/news/container";
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
export const POST = withAuth(async (request: Request): Promise<Response> => {
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
    // Server-injected context (never trusted from the client body): the analysis
    // wall-clock time and the recent advice history for this symbol/interval.
    const history = readMarketAdviceHistory({
      symbol: parsed.data.symbol,
      interval: parsed.data.interval,
      limit: 3,
    });
    const result = await runMarketAdvisor({
      provider,
      request: {
        ...parsed.data,
        analysisTime: new Date().toISOString(),
        previousAdvice:
          history.length === 0
            ? undefined
            : history.map((record) => ({
                generatedAt: record.generatedAt,
                action: record.decision.action,
                label: record.decision.label,
                lastPrice: record.lastPrice,
              })),
      },
      jsonSchema: marketAdvisorJsonSchema,
      newsSearch: getServerNewsSearch() ?? undefined,
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
    if (error instanceof MarketAdvisorResponseError) {
      return NextResponse.json(
        { error: { code: "market-advisor-response-invalid", message: "AI market advisor response is invalid" } },
        { status: 502 },
      );
    }
    return handleAdvisorError(error);
  }
});
