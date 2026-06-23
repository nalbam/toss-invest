import "server-only";
import { createChatCompletionsProvider } from "./chat-completions";
import type { LlmFetchFn, LlmProvider } from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn: LlmFetchFn;
  /** Cost/latency guard: aborts the request after this many ms. */
  timeoutMs?: number;
}

export function createOpenAiProvider(config: OpenAiProviderConfig): LlmProvider {
  return createChatCompletionsProvider({
    name: "openai",
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    fetchFn: config.fetchFn,
    timeoutMs: config.timeoutMs,
  });
}
