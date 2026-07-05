import { z } from "zod";
import { invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { readPortfolioAdviceHistory } from "@/lib/server/advisor/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  // `?accountSeq=` yields "" which z.coerce.number() turns into 0; map empty to
  // undefined and require a positive int so blank/non-positive values are rejected.
  accountSeq: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  limit: z.coerce.number().int().positive().max(200).default(100),
});

/**
 * Read-only view of the persisted portfolio advice log (SQLite). Lets the
 * dashboard advisor card restore the latest advice when its per-tab
 * sessionStorage cache is empty (new tab, browser restart, account switch).
 */
export const GET = withAuth(async (request: Request): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid portfolio advisor history query parameters");
  }

  const history = readPortfolioAdviceHistory(parsed.data);
  return ok({ events: history });
});
