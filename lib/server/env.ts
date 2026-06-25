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

/**
 * Optional config string that treats an empty/whitespace value as unset — same
 * `.env.example` trap as the amounts above: a bare `OPENAI_API_KEY=` line loads
 * as "" (present, not undefined), so map blank to undefined to keep it optional.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalConfigString = z.preprocess(blankToUndefined, z.string().min(1).optional());

const optionalLlmProvider = z.preprocess(
  blankToUndefined,
  z.enum(["openai", "xai"]).optional(),
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
  // AI advisor (Phase 4). All optional so the app boots without LLM credentials;
  // only the advisor path reports "not configured". Keys are server-only
  // (lib/server/llm/**) — never exposed to the client bundle (build gate guards).
  LLM_PROVIDER: optionalLlmProvider,
  OPENAI_API_KEY: optionalConfigString,
  XAI_API_KEY: optionalConfigString,
  LLM_MODEL: optionalConfigString,
  // Tavily news search (optional). Unset/blank => the market advisor runs
  // chart-only (fail-open), never erroring. Server-only (lib/server/news/**).
  TAVILY_API_KEY: optionalConfigString,
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
