import "server-only";
import { getEnv, type Env } from "@/lib/server/env";
import { createOpenAiProvider } from "./openai";
import { createXaiProvider } from "./xai";
import type { LlmFetchFn, LlmProvider } from "./types";

/**
 * Thrown when the advisor path is reached without LLM credentials configured.
 * The advisor route maps this to a clean "not configured" response; the rest of
 * the app (dashboard, trading) is unaffected, since the LLM env is optional.
 */
export class LlmNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmNotConfiguredError";
  }
}

type LlmEnv = Pick<
  Env,
  "LLM_PROVIDER" | "OPENAI_API_KEY" | "XAI_API_KEY" | "LLM_MODEL"
>;

export interface LlmProviderDeps {
  env: LlmEnv;
  fetchFn: LlmFetchFn;
  timeoutMs?: number;
}

/**
 * Pure selection: builds the provider named by `LLM_PROVIDER`, or throws
 * `LlmNotConfiguredError` when the provider, its key, or the model is unset.
 * Selection is by `LLM_PROVIDER` only — never by which key happens to be set —
 * so a misconfigured pair fails loudly instead of silently using the other one.
 */
export function resolveLlmProvider(deps: LlmProviderDeps): LlmProvider {
  const { env, fetchFn, timeoutMs } = deps;
  if (!env.LLM_PROVIDER) {
    throw new LlmNotConfiguredError("LLM_PROVIDER is not set");
  }
  if (!env.LLM_MODEL) {
    throw new LlmNotConfiguredError("LLM_MODEL is not set");
  }
  switch (env.LLM_PROVIDER) {
    case "openai":
      if (!env.OPENAI_API_KEY) {
        throw new LlmNotConfiguredError("OPENAI_API_KEY is not set");
      }
      return createOpenAiProvider({
        apiKey: env.OPENAI_API_KEY,
        model: env.LLM_MODEL,
        fetchFn,
        timeoutMs,
      });
    case "xai":
      if (!env.XAI_API_KEY) {
        throw new LlmNotConfiguredError("XAI_API_KEY is not set");
      }
      return createXaiProvider({
        apiKey: env.XAI_API_KEY,
        model: env.LLM_MODEL,
        fetchFn,
        timeoutMs,
      });
  }
}

let cached: LlmProvider | null = null;

/**
 * Process-wide configured LLM provider, assembled from validated env and the
 * real global `fetch`. Throws `LlmNotConfiguredError` when credentials are
 * absent (errors are not cached, so the path recovers once env is set).
 */
export function getServerLlmProvider(): LlmProvider {
  if (cached === null) {
    cached = resolveLlmProvider({
      env: getEnv(),
      fetchFn: (url, init) => fetch(url, init),
    });
  }
  return cached;
}
