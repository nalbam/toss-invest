import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import {
  getServerTossClient,
  getServerTradingExecutor,
} from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
});

/**
 * Cancel body is `{ confirm?: boolean }`; an empty object (or empty request
 * body) is allowed. `confirm` is read ONLY from the body and defaults to
 * `false`, so an unconfirmed cancel yields a DRY_RUN preview — the route never
 * confirms on the caller's behalf.
 */
const bodySchema = z.object({
  confirm: z.boolean().default(false),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const { orderId } = await context.params;
  if (orderId.length === 0) {
    return invalidRequest("Missing orderId");
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
  });
  if (!parsedQuery.success) {
    return invalidRequest("Invalid accountSeq query parameter");
  }

  // An empty body is valid for a cancel; treat unparseable/empty JSON as `{}`.
  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      raw = JSON.parse(text);
    }
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsedBody = bodySchema.safeParse(raw);
  if (!parsedBody.success) {
    return invalidRequest("Invalid cancel request body");
  }

  try {
    const client = getServerTossClient();
    let { accountSeq } = parsedQuery.data;
    if (accountSeq === undefined) {
      const accounts = await client.getAccounts();
      const first = accounts[0];
      if (!first) {
        return invalidRequest("No account available to resolve accountSeq");
      }
      accountSeq = first.accountSeq;
    }

    const executor = getServerTradingExecutor();
    const result = await executor.cancelOrder(accountSeq, {
      orderId,
      confirm: parsedBody.data.confirm,
    });

    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}
