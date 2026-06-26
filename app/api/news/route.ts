import { z } from "zod";
import { invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerNewsSearch } from "@/lib/server/news/container";

export const dynamic = "force-dynamic";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const querySchema = z.object({
  symbol: z.string().regex(symbolPattern),
  name: z.string().min(1).optional(),
});

/**
 * Recent symbol news for the dashboard. The query is `name ?? symbol` — the same
 * key the market advisor uses (`runMarketAdvisor`) — so a symbol viewed here and
 * analyzed by the advisor share the one 10-minute process cache (one Tavily call
 * total). News is auxiliary: an unconfigured key or an upstream failure returns
 * an empty list (200), never an error, so the card degrades quietly.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    symbol: searchParams.get("symbol") ?? undefined,
    name: searchParams.get("name") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Missing or invalid symbol query parameter");
  }

  const search = getServerNewsSearch();
  if (search === null) {
    // TAVILY_API_KEY not configured → no news, fail-open like the advisor path.
    return ok([]);
  }

  try {
    return ok(
      await search({
        query: parsed.data.name ?? parsed.data.symbol,
        symbol: parsed.data.symbol,
        name: parsed.data.name,
      }),
    );
  } catch {
    // Best-effort: an upstream search failure must not break the card.
    return ok([]);
  }
}
