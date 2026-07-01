import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";
import { resolveAccountSeq } from "@/lib/server/toss/account";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  // `?accountSeq=` → "" which z.coerce.number() turns into 0; map empty to
  // undefined so a blank value falls back to the first account (see /api/advisor).
  accountSeq: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().optional(),
  ),
  currency: z.string().min(1),
});

export const GET = withAuth(async (request: Request): Promise<Response> => {
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
    const accountSeq = await resolveAccountSeq(client, parsed.data.accountSeq);
    if (accountSeq === null) {
      return invalidRequest("No account available to resolve accountSeq");
    }
    const data = await client.getBuyingPower({
      accountSeq,
      currency: parsed.data.currency,
    });
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
