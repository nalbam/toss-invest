import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import {
  getServerTossClient,
  getServerTradingExecutor,
} from "@/lib/server/toss/container";
import { assembleModifyContext } from "@/lib/server/trading/context";
import { orderModifyRequestSchema } from "@/lib/server/toss/schemas";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
});

/**
 * `confirm` is the per-order human confirmation, read ONLY from the request body
 * and defaulting to `false`. An omitted confirm yields a DRY_RUN preview; the
 * route never sets it to `true` for the caller.
 */
const confirmSchema = z.object({
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsedModify = orderModifyRequestSchema.safeParse(raw);
  if (!parsedModify.success) {
    return invalidRequest("Invalid order modify request body");
  }
  const parsedConfirm = confirmSchema.safeParse(raw);
  if (!parsedConfirm.success) {
    return invalidRequest("Invalid confirm flag");
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

    // Resolve the original order's symbol/quantity (and fx/reference price) so
    // the gate can re-value the modify. A failed lookup throws here and maps to
    // an error response — the gate is never run on guessed inputs.
    const original = await assembleModifyContext(
      client,
      accountSeq,
      orderId,
      parsedModify.data,
    );

    const executor = getServerTradingExecutor();
    const result = await executor.modifyOrder(accountSeq, {
      orderId,
      symbol: original.symbol,
      request: parsedModify.data,
      confirm: parsedConfirm.data.confirm,
      fxRate: original.fxRate,
      referencePrice: original.referencePrice,
      originalQuantity: original.originalQuantity,
    });

    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}
