import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
  currency: z.string().min(1),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
    currency: searchParams.get("currency") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Missing required currency query parameter");
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
    const data = await client.getBuyingPower({
      accountSeq,
      currency: parsed.data.currency,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
