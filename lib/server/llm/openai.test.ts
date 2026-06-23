import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { createOpenAiProvider } from "./openai";
import type { ChatRequest } from "./types";

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const okPayload = {
  model: "gpt-test",
  choices: [{ index: 0, message: { role: "assistant", content: "{\"advice\":\"hi\"}" } }],
};

function setup(response: Response) {
  const fetchFn: FetchMock = vi.fn(async () => response);
  const provider = createOpenAiProvider({
    apiKey: "test-key-SECRET",
    model: "gpt-test",
    fetchFn,
  });
  return { fetchFn, provider };
}

const baseRequest: ChatRequest = {
  messages: [
    { role: "system", content: "you are an advisor" },
    { role: "user", content: "analyze" },
  ],
};

function lastInit(fetchFn: FetchMock): RequestInit {
  return fetchFn.mock.calls[0][1];
}

function lastBody(fetchFn: FetchMock): Record<string, unknown> {
  return JSON.parse(lastInit(fetchFn).body as string);
}

describe("createOpenAiProvider", () => {
  it("identifies itself as the openai provider", () => {
    const { provider } = setup(jsonResponse(okPayload));
    expect(provider.name).toBe("openai");
  });

  it("POSTs to /chat/completions with bearer auth and a json body", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    await provider.chat(baseRequest);

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");

    const init = lastInit(fetchFn);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key-SECRET");
    expect(headers["content-type"]).toBe("application/json");

    const body = lastBody(fetchFn);
    expect(body.model).toBe("gpt-test");
    expect(body.messages).toEqual(baseRequest.messages);
  });

  it("requests strict json_schema structured output when jsonSchema is set", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    const schema = { type: "object", properties: {}, additionalProperties: false };
    await provider.chat({ ...baseRequest, jsonSchema: { name: "advice", schema } });

    const body = lastBody(fetchFn);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "advice", strict: true, schema },
    });
  });

  it("omits response_format when no jsonSchema is requested", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    await provider.chat(baseRequest);
    expect(lastBody(fetchFn).response_format).toBeUndefined();
  });

  it("maps temperature and maxTokens to the API field names", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    await provider.chat({ ...baseRequest, temperature: 0.2, maxTokens: 512 });
    const body = lastBody(fetchFn);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(512);
  });

  it("passes an abort signal (timeout cost guard)", async () => {
    const { fetchFn, provider } = setup(jsonResponse(okPayload));
    await provider.chat(baseRequest);
    expect(lastInit(fetchFn).signal).toBeInstanceOf(AbortSignal);
  });

  it("parses content and model from choices[0].message", async () => {
    const { provider } = setup(jsonResponse(okPayload));
    const result = await provider.chat(baseRequest);
    expect(result.content).toBe("{\"advice\":\"hi\"}");
    expect(result.model).toBe("gpt-test");
  });

  it("throws on a non-2xx response without leaking the api key", async () => {
    const { provider } = setup(jsonResponse({ error: "nope" }, 401));
    await expect(provider.chat(baseRequest)).rejects.toThrow(/status 401/);
    await expect(provider.chat(baseRequest)).rejects.not.toThrow(/test-key-SECRET/);
  });

  it("throws when the response has no usable message content", async () => {
    const { provider } = setup(jsonResponse({ model: "gpt-test", choices: [] }));
    await expect(provider.chat(baseRequest)).rejects.toThrow(/choices/);
  });
});
