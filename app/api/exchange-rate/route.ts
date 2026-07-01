import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  baseCurrency: z.string().min(1),
  quoteCurrency: z.string().min(1),
  dateTime: z.string().min(1).optional(),
});

export const GET = withAuth(async (request: Request): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    baseCurrency: searchParams.get("baseCurrency") ?? undefined,
    quoteCurrency: searchParams.get("quoteCurrency") ?? undefined,
    dateTime: searchParams.get("dateTime") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest(
      "Missing required baseCurrency or quoteCurrency query parameter",
    );
  }

  try {
    const data = await getServerTossClient().getExchangeRate(parsed.data);
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
