import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { searchStockDirectory } from "@/lib/server/stocks/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Missing or invalid q query parameter");
  }
  try {
    return ok({ items: searchStockDirectory(parsed.data.q, parsed.data.limit) });
  } catch (error) {
    return handleError(error);
  }
}
