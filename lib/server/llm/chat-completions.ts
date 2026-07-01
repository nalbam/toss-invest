import "server-only";
import type {
  ChatRequest,
  ChatResponse,
  LlmFetchFn,
  LlmProvider,
  LlmProviderName,
} from "./types";

// Shared OpenAI-compatible chat-completions core. Both OpenAI and xAI speak the
// same contract (verified against developers.openai.com and docs.x.ai):
//   POST {baseUrl}/chat/completions
//   headers: Authorization: Bearer <key>, Content-Type: application/json
//   body: { model, messages, response_format?, temperature?, max_tokens? }
//   structured output: response_format = { type: "json_schema",
//     json_schema: { name, strict: true, schema } }
//   response: choices[0].message.content (a JSON string when structured)
// Adapters differ only in name + default base URL, so they delegate here.
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thrown when the provider's chat-completions endpoint returns a non-2xx status.
 * A typed class (not a bare `Error`) so callers map it to a 502 via `instanceof`
 * instead of matching the message text. The message carries only the status —
 * never the request body or the api key.
 */
export class ChatRequestError extends Error {
  readonly status: number;
  constructor(name: LlmProviderName, status: number) {
    super(`${name} chat request failed with status ${status}`);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

export interface ChatCompletionsConfig {
  name: LlmProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchFn: LlmFetchFn;
  /** Cost/latency guard: aborts the request after this many ms. */
  timeoutMs?: number;
}

/**
 * Maps the raw chat response into our internal shape. Isolated so a provider
 * payload change is a one-function swap. Throws (rather than returning partial)
 * on any missing field — the response is an untrusted boundary.
 */
function parseChatResponse(name: LlmProviderName, payload: unknown): ChatResponse {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`${name} chat response is not an object`);
  }
  const record = payload as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`${name} chat response has no choices`);
  }
  const first = choices[0];
  const message =
    typeof first === "object" && first !== null
      ? (first as Record<string, unknown>).message
      : undefined;
  const content =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>).content
      : undefined;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`${name} chat response missing message content`);
  }
  const model = typeof record.model === "string" ? record.model : "";
  return { content, model };
}

export function createChatCompletionsProvider(
  config: ChatCompletionsConfig,
): LlmProvider {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: config.name,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: request.messages,
      };
      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }
      if (request.maxTokens !== undefined) {
        body.max_tokens = request.maxTokens;
      }
      if (request.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.jsonSchema.name,
            strict: true,
            schema: request.jsonSchema.schema,
          },
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await config.fetchFn(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // Status only — never echo the request body or the api key.
        throw new ChatRequestError(config.name, response.status);
      }

      return parseChatResponse(config.name, await response.json());
    },
  };
}
