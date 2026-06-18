import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import {
  getServerTossClient,
  getServerTradingExecutor,
} from "@/lib/server/toss/container";
import { assembleCreateContext } from "@/lib/server/trading/context";
import { orderCreateRequestSchema } from "@/lib/server/toss/schemas";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
  status: z.enum(["OPEN", "CLOSED"]).default("OPEN"),
  symbol: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const postQuerySchema = z.object({
  accountSeq: z.coerce.number().int().optional(),
});

/**
 * `confirm` is the per-order human confirmation. It is read ONLY from the
 * request body and defaults to `false`, so a caller that omits it gets a
 * DRY_RUN preview — the route never sets it to `true` on the caller's behalf.
 */
const confirmSchema = z.object({
  confirm: z.boolean().default(false),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountSeq: searchParams.get("accountSeq") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    symbol: searchParams.get("symbol") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return invalidRequest("Invalid orders query parameters");
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
    const data = await client.getOrders({
      accountSeq,
      status: parsed.data.status,
      symbol: parsed.data.symbol,
      from: parsed.data.from,
      to: parsed.data.to,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}

/** Informational prevalidation attached to the preview (never a hard stop). */
interface Prevalidation {
  side: "BUY" | "SELL";
  /** Buying power (BUY) or sellable quantity (SELL), or null if unreadable. */
  available: string | null;
  /** Requested quantity/amount, when the body carries one. */
  requested: string | null;
  /** True when `available` is known and below `requested` (advisory only). */
  insufficient: boolean;
}

/**
 * BUY: reads cash buying power in the order's currency. SELL: reads the sellable
 * quantity. The flag is advisory only — the §6 gate is the hard stop, and the
 * upstream API rejects a genuinely under-funded order with a 422. A lookup
 * failure leaves the values unknown and NEVER blocks the order.
 */
async function prevalidate(
  client: ReturnType<typeof getServerTossClient>,
  accountSeq: number | string,
  request: z.infer<typeof orderCreateRequestSchema>,
): Promise<Prevalidation> {
  const isKrw = /^\d{6}$/.test(request.symbol);
  const requested =
    "orderAmount" in request ? request.orderAmount : request.quantity;
  try {
    if (request.side === "BUY") {
      const power = await client.getBuyingPower({
        accountSeq,
        currency: isKrw ? "KRW" : "USD",
      });
      const available = power.cashBuyingPower;
      return {
        side: "BUY",
        available,
        requested,
        insufficient: Number(available) < Number(requested),
      };
    }
    const sellable = await client.getSellableQuantity({
      accountSeq,
      symbol: request.symbol,
    });
    const available = sellable.sellableQuantity;
    return {
      side: "SELL",
      available,
      requested,
      insufficient: Number(available) < Number(requested),
    };
  } catch {
    // Prevalidation is supplementary; a failed lookup must not block the order.
    return { side: request.side, available: null, requested, insufficient: false };
  }
}

export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsedQuery = postQuerySchema.safeParse({
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

  const parsedOrder = orderCreateRequestSchema.safeParse(raw);
  if (!parsedOrder.success) {
    return invalidRequest("Invalid order request body");
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

    const gateInputs = await assembleCreateContext(client, parsedOrder.data);
    const prevalidation = await prevalidate(
      client,
      accountSeq,
      parsedOrder.data,
    );

    const executor = getServerTradingExecutor();
    const result = await executor.placeOrder(accountSeq, {
      request: parsedOrder.data,
      confirm: parsedConfirm.data.confirm,
      fxRate: gateInputs.fxRate,
      referencePrice: gateInputs.referencePrice,
    });

    return ok({ ...result, prevalidation });
  } catch (error) {
    return handleError(error);
  }
}
