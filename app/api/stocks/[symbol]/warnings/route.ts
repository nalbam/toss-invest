import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

export const GET = withAuth(async (
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
): Promise<Response> => {
  const { symbol } = await context.params;
  if (!symbolPattern.test(symbol)) {
    return invalidRequest("Invalid symbol");
  }

  try {
    const data = await getServerTossClient().getStockWarnings({ symbol });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
