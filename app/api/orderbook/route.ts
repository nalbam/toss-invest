import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const querySchema = z.object({
  symbol: z.string().regex(symbolPattern),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    symbol: searchParams.get("symbol") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Missing or invalid symbol query parameter");
  }

  try {
    const data = await getServerTossClient().getOrderbook({
      symbol: parsed.data.symbol,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
