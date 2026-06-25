import { NextResponse } from "next/server";
import { handleError, ok } from "@/lib/server/api/respond";
import { getServerLlmProvider, LlmNotConfiguredError } from "@/lib/server/llm/container";
import { getServerNewsSearch } from "@/lib/server/news/container";
import { runAdvisorJobsOnce } from "@/lib/server/market-advisor/jobs";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Background trigger: runs one advisor pass over the enabled watchlist. Protected
 * by ADVISOR_JOBS_TOKEN (Bearer). Fail-closed: if the token is unset, the route
 * is disabled (401). Meant to be called by an external scheduler (cron / script),
 * keeping the standing-loop out of the app per the project's trigger-separation
 * convention.
 */
export async function POST(request: Request): Promise<Response> {
  const token = process.env.ADVISOR_JOBS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: { code: "advisor-jobs-disabled", message: "ADVISOR_JOBS_TOKEN is not configured" } },
      { status: 401 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid or missing token" } },
      { status: 401 },
    );
  }

  try {
    const summary = await runAdvisorJobsOnce({
      client: getServerTossClient(),
      provider: getServerLlmProvider(),
      newsSearch: getServerNewsSearch() ?? undefined,
    });
    return ok(summary);
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return NextResponse.json(
        { error: { code: "advisor-not-configured", message: "AI advisor is not configured" } },
        { status: 503 },
      );
    }
    return handleError(error);
  }
}
