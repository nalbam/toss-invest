import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import {
  addFavorite,
  listFavorites,
  removeFavorite,
} from "@/lib/server/favorites/store";
import { upsertStockDirectory } from "@/lib/server/stocks/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const addSchema = z.object({
  symbol: z.string().regex(symbolPattern),
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
});

export const GET = withAuth(async (): Promise<Response> => {
  try {
    return ok({ items: listFavorites() });
  } catch (error) {
    return handleError(error);
  }
});

export const POST = withAuth(async (request: Request): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid favorite");
  }
  try {
    const item = addFavorite(parsed.data);
    // A favorited stock carries a trusted name → seed the name-search directory.
    if (parsed.data.name) {
      try {
        upsertStockDirectory([
          {
            symbol: parsed.data.symbol,
            name: parsed.data.name,
            currency: parsed.data.currency ?? null,
          },
        ]);
      } catch {
        // Best-effort directory seeding.
      }
    }
    return ok({ item });
  } catch (error) {
    return handleError(error);
  }
});

export const DELETE = withAuth(async (request: Request): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (symbol === null || !symbolPattern.test(symbol)) {
    return invalidRequest("Invalid symbol");
  }
  try {
    removeFavorite(symbol);
    return ok({});
  } catch (error) {
    return handleError(error);
  }
});
