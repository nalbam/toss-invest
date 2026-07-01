import { NextResponse } from "next/server";
import { ok } from "@/lib/server/api/respond";
import { handleAdvisorError } from "@/lib/server/api/advisor-error";
import { getServerLlmProvider } from "@/lib/server/llm/container";
import { getServerNewsSearch } from "@/lib/server/news/container";
import { runAdvisorJobsOnce } from "@/lib/server/market-advisor/jobs";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Background trigger: runs one advisor pass over the enabled watchlist. This is a
 * machine-to-machine endpoint authenticated by ADVISOR_JOBS_TOKEN (Bearer), NOT
 * a user session — external schedulers (cron / `scripts/advisor-run.mjs`) have no
 * session cookie, so it is deliberately NOT wrapped in `withAuth`. Fail-closed:
 * if the token is unset the route is disabled (401). Kept out of the standing
 * loop per the project's trigger-separation convention.
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
    return handleAdvisorError(error);
  }
}
