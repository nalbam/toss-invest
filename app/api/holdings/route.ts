import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
  symbol: z.string().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
    symbol: searchParams.get("symbol") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid accountSeq or symbol query parameter");
  }

  try {
    const client = getServerTossClient();
    let { accountSeq } = parsed.data;
    if (accountSeq === undefined) {
      const accounts = await client.getAccounts();
      const first = accounts[0];
      if (!first) {
        return invalidRequest("No account available to resolve accountSeq");
      }
      accountSeq = first.accountSeq;
    }
    const data = await client.getHoldings({
      accountSeq,
      symbol: parsed.data.symbol,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
