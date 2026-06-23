import "server-only";

/**
 * Provider-agnostic LLM chat contract for the AI advisor. Both supported
 * providers (OpenAI, xAI) speak OpenAI-compatible chat completions, so a single
 * interface fits behind an adapter that only differs in base URL, key, model,
 * and structured-output details.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** JSON schema the provider must shape its output to (structured output). */
export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /**
   * When set, the adapter requests provider-native structured output for this
   * JSON schema. The returned text is still treated as untrusted and must be
   * re-validated (advisor zod schema) before use.
   */
  jsonSchema?: JsonSchemaSpec;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  /** Raw assistant text — a JSON string when jsonSchema was requested. Untrusted. */
  content: string;
  /** Model id echoed by the provider. */
  model: string;
}

export type LlmProviderName = "openai" | "xai";

export interface LlmProvider {
  readonly name: LlmProviderName;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

/** Injected fetch (DI), mirroring the toss auth layer so tests stay deterministic. */
export type LlmFetchFn = (url: string, init: RequestInit) => Promise<Response>;
