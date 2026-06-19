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

/**
 * Optional positive amount that treats an empty/whitespace string as unset.
 * dotenv loads a bare `MAX_ORDER_AMOUNT=` line (as left by `.env.example`) as
 * "" — present, not undefined — so a plain `.optional()` would run validation on
 * "" and throw. Mapping blank to undefined makes it behave as unset (the gate
 * then fail-safe BLOCKs real orders) instead of crashing config load.
 */
const optionalPositiveAmount = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  positiveAmountFromString.optional(),
);

const envSchema = z.object({
  TOSS_CLIENT_ID: z.string().min(1),
  TOSS_CLIENT_SECRET: z.string().min(1),
  TOSS_ACCOUNT_SEQ: z.string().min(1),
  TOSS_API_BASE: z.url().default("https://openapi.tossinvest.com"),
  DRY_RUN: booleanFromString.default(true),
  KILL_SWITCH: booleanFromString.default(false),
  // Phase 3 auto-trade activation. Defaults to false: an automated loop is never
  // armed unless a human sets this explicitly (out-of-band approval, §6.2). The
  // auto-executor reads this and passes it as the §6 `confirm`; it does NOT
  // weaken any other gate (DRY_RUN / limits / kill switch still apply).
  AUTO_TRADE_ENABLED: booleanFromString.default(false),
  // Hard limits (§6). Unset/blank => the gate blocks real orders (fail-safe).
  MAX_ORDER_AMOUNT: optionalPositiveAmount,
  DAILY_LOSS_LIMIT: optionalPositiveAmount,
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
