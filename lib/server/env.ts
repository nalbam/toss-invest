import "server-only";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  TOSS_CLIENT_ID: z.string().min(1),
  TOSS_CLIENT_SECRET: z.string().min(1),
  TOSS_ACCOUNT_SEQ: z.string().min(1),
  TOSS_API_BASE: z.url().default("https://openapi.tossinvest.com"),
  DRY_RUN: booleanFromString.default(true),
  KILL_SWITCH: booleanFromString.default(false),
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
