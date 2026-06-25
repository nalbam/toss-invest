import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";
import { getCandlesCached } from "@/lib/server/candles/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const querySchema = z.object({
  symbol: z.string().regex(symbolPattern),
  interval: z.enum(["1m", "1d"]),
  count: z.coerce.number().int().positive().optional(),
  before: z.string().min(1).optional(),
  // `adjusted` arrives as a query string; only the literal "true"/"false" are
  // accepted so a malformed value fails validation rather than silently
  // coercing (z.coerce.boolean treats any non-empty string as true).
  adjusted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    symbol: searchParams.get("symbol") ?? undefined,
    interval: searchParams.get("interval") ?? undefined,
    count: searchParams.get("count") ?? undefined,
    before: searchParams.get("before") ?? undefined,
    adjusted: searchParams.get("adjusted") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest(
      "Missing or invalid symbol or interval query parameter",
    );
  }

  try {
    // Cache-backed: confirmed history is served from the local cache; the
    // forming candle and any gaps come live from Toss (which also fills the
    // cache). See lib/server/candles/service.
    const data = await getCandlesCached(
      {
        symbol: parsed.data.symbol,
        interval: parsed.data.interval,
        count: parsed.data.count,
        before: parsed.data.before,
        adjusted: parsed.data.adjusted,
      },
      { client: getServerTossClient() },
    );
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
