import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { createXaiProvider } from "./xai";
import type { ChatRequest } from "./types";

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const okPayload = {
  model: "grok-test",
  choices: [{ index: 0, message: { role: "assistant", content: "{\"advice\":\"hi\"}" } }],
};

function setup(response: Response) {
  const fetchFn: FetchMock = vi.fn(async () => response);
  const provider = createXaiProvider({
    apiKey: "xai-key-SECRET",
    model: "grok-test",
    fetchFn,
  });
  return { fetchFn, provider };
}

const baseRequest: ChatRequest = {
  messages: [{ role: "user", content: "analyze" }],
};

describe("createXaiProvider", () => {
  it("identifies itself as the xai provider", () => {
    const { provider } = setup(jsonResponse(okPayload));
    expect(provider.name).toBe("xai");
  });

  it("POSTs to the x.ai chat completions endpoint with bearer auth", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    await provider.chat(baseRequest);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer xai-key-SECRET");
  });

  it("requests strict json_schema structured output (OpenAI-compatible)", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    const schema = { type: "object", properties: {}, additionalProperties: false };
    await provider.chat({ ...baseRequest, jsonSchema: { name: "advice", schema } });

    const body = JSON.parse(
      fetchFn.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(body.model).toBe("grok-test");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "advice", strict: true, schema },
    });
  });

  it("parses content and model from choices[0].message", async () => {
    const { provider } = setup(jsonResponse(okPayload));
    const result = await provider.chat(baseRequest);
    expect(result.content).toBe("{\"advice\":\"hi\"}");
    expect(result.model).toBe("grok-test");
  });

  it("throws on a non-2xx response without leaking the api key", async () => {
    const { provider } = setup(jsonResponse({ error: "nope" }, 429));
    await expect(provider.chat(baseRequest)).rejects.toThrow(/status 429/);
    await expect(provider.chat(baseRequest)).rejects.not.toThrow(/xai-key-SECRET/);
  });
});
