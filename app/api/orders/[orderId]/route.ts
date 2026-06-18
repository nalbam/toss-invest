import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await context.params;
  if (orderId.length === 0) {
    return invalidRequest("Missing orderId");
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid accountSeq query parameter");
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
    const data = await client.getOrder({ accountSeq, orderId });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
