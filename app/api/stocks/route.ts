import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";
import { upsertStockDirectory } from "@/lib/server/stocks/directory";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  symbols: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((symbol) => symbol.trim())
        .filter((symbol) => symbol.length > 0),
    )
    .pipe(z.array(z.string()).min(1)),
});

export const GET = withAuth(async (request: Request): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    symbols: searchParams.get("symbols") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Missing required symbols query parameter");
  }

  try {
    const data = await getServerTossClient().getStocks({
      symbols: parsed.data.symbols,
    });
    // Seed the local name-search directory from this trusted Toss result.
    try {
      upsertStockDirectory(
        data.map((stock) => ({
          symbol: stock.symbol,
          name: stock.name,
          market: stock.market,
          currency: stock.currency,
        })),
      );
    } catch {
      // Best-effort; directory seeding must never fail the lookup response.
    }
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
