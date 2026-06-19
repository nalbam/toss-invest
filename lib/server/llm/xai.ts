import "server-only";
import { createChatCompletionsProvider } from "./chat-completions";
import type { LlmFetchFn, LlmProvider } from "./types";

// xAI (Grok) is fully OpenAI REST-compatible (verified against docs.x.ai), so
// this adapter only changes the name and default base URL.
const DEFAULT_BASE_URL = "https://api.x.ai/v1";

export interface XaiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn: LlmFetchFn;
  /** Cost/latency guard: aborts the request after this many ms. */
  timeoutMs?: number;
}

export function createXaiProvider(config: XaiProviderConfig): LlmProvider {
  return createChatCompletionsProvider({
    name: "xai",
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    fetchFn: config.fetchFn,
    timeoutMs: config.timeoutMs,
  });
}
