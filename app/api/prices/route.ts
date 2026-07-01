import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const data = await getServerTossClient().getPrices({
      symbols: parsed.data.symbols,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
