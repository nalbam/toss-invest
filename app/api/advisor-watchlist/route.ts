import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import {
  addWatchlist,
  listWatchlist,
  removeWatchlist,
  setWatchlistEnabled,
  setWatchlistRunEvery,
} from "@/lib/server/market-advisor/watchlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const addSchema = z.object({
  symbol: z.string().regex(symbolPattern),
  name: z.string().min(1).optional(),
  interval: z.string().min(1),
  currency: z.string().min(1).optional(),
  runEveryMinutes: z.number().int().positive().optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  runEveryMinutes: z.number().int().positive().optional(),
});

export async function GET(): Promise<Response> {
  try {
    return ok({ items: listWatchlist() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid watchlist item");
  }
  try {
    return ok({ item: addWatchlist(parsed.data) });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid watchlist update");
  }
  try {
    if (parsed.data.enabled !== undefined) {
      setWatchlistEnabled(parsed.data.id, parsed.data.enabled);
    }
    if (parsed.data.runEveryMinutes !== undefined) {
      setWatchlistRunEvery(parsed.data.id, parsed.data.runEveryMinutes);
    }
    return ok({});
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return invalidRequest("Invalid id");
  }
  try {
    removeWatchlist(id);
    return ok({});
  } catch (error) {
    return handleError(error);
  }
}
