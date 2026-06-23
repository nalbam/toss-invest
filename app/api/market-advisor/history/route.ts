import { z } from "zod";
import { invalidRequest, ok } from "@/lib/server/api/respond";
import { readMarketAdviceHistory } from "@/lib/server/cache/market-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const querySchema = z.object({
  symbol: z.string().regex(symbolPattern),
  interval: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    symbol: searchParams.get("symbol") ?? undefined,
    interval: searchParams.get("interval") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid market advisor history query parameters");
  }

  const history = await readMarketAdviceHistory(parsed.data);
  return ok({ events: history });
}
