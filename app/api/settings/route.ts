import { z } from "zod";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import {
  applySettings,
  getAllSettings,
  SettingsLimitError,
} from "@/lib/server/settings/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Settings keys are namespaced under "toss-invest:" with a bounded charset so
// the global KV store can't be filled with arbitrary keys.
const keyPattern = /^toss-invest:[A-Za-z0-9:_.\-]+$/;
// UI settings values are small (theme, flags, JSON blobs); cap well below the
// old 1MB so a single request can't write a huge payload.
const MAX_VALUE_LEN = 64 * 1024;

const keySchema = z.string().regex(keyPattern).max(256);

const entrySchema = z.object({
  key: keySchema,
  value: z.string().max(MAX_VALUE_LEN),
});

const putSchema = z.object({
  upserts: z.array(entrySchema).max(100).optional(),
  deletes: z.array(keySchema).max(100).optional(),
});

export const GET = withAuth(async (): Promise<Response> => {
  try {
    return ok({ settings: getAllSettings() });
  } catch (error) {
    return handleError(error);
  }
});

export const PUT = withAuth(async (request: Request): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid settings change");
  }
  try {
    applySettings(parsed.data);
    return ok({});
  } catch (error) {
    if (error instanceof SettingsLimitError) {
      return invalidRequest("Settings key limit exceeded");
    }
    return handleError(error);
  }
});
