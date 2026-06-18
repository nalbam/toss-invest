import "server-only";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/**
 * Positive KRW amount limit. Kept optional (not defaulted) so the trading gate
 * can treat an unset limit as "no real orders allowed" (fail-safe) rather than
 * silently picking a permissive default.
 */
const positiveAmountFromString = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform((value) => Number(value))
  .refine((value) => value > 0, "must be a positive amount");

const envSchema = z.object({
  TOSS_CLIENT_ID: z.string().min(1),
  TOSS_CLIENT_SECRET: z.string().min(1),
  TOSS_ACCOUNT_SEQ: z.string().min(1),
  TOSS_API_BASE: z.url().default("https://openapi.tossinvest.com"),
  DRY_RUN: booleanFromString.default(true),
  KILL_SWITCH: booleanFromString.default(false),
  // Hard limits (§6). Unset => the gate blocks real orders (fail-safe).
  MAX_ORDER_AMOUNT: positiveAmountFromString.optional(),
  DAILY_LOSS_LIMIT: positiveAmountFromString.optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv === null) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}
