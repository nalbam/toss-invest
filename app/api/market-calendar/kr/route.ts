import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  date: z.string().min(1).optional(),
});

export const GET = withAuth(async (request: Request): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid date query parameter");
  }

  try {
    const data = await getServerTossClient().getKrMarketCalendar({
      date: parsed.data.date,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
