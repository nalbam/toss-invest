import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await context.params;
  if (symbol.length === 0) {
    return invalidRequest("Missing symbol");
  }

  try {
    const data = await getServerTossClient().getStockWarnings({ symbol });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
