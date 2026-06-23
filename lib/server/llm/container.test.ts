import { describe, expect, it } from "vitest";
import { LlmNotConfiguredError, resolveLlmProvider } from "./container";
import type { LlmFetchFn } from "./types";

// fetch is never actually invoked by resolveLlmProvider (it only constructs the
// adapter), so a noop stub keeps these tests deterministic and offline.
const fetchFn: LlmFetchFn = async () => new Response("{}");

const unsetEnv = {
  LLM_PROVIDER: undefined,
  OPENAI_API_KEY: undefined,
  XAI_API_KEY: undefined,
  LLM_MODEL: undefined,
} as const;

describe("resolveLlmProvider", () => {
  it("throws LlmNotConfiguredError when LLM_PROVIDER is unset", () => {
    expect(() => resolveLlmProvider({ env: { ...unsetEnv }, fetchFn })).toThrow(
      LlmNotConfiguredError,
    );
  });

  it("throws not-configured when the model is unset", () => {
    expect(() =>
      resolveLlmProvider({
        env: { ...unsetEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-x" },
        fetchFn,
      }),
    ).toThrow(LlmNotConfiguredError);
  });

  it("throws not-configured when the openai key is missing", () => {
    expect(() =>
      resolveLlmProvider({
        env: { ...unsetEnv, LLM_PROVIDER: "openai", LLM_MODEL: "gpt-x" },
        fetchFn,
      }),
    ).toThrow(LlmNotConfiguredError);
  });

  it("throws not-configured when the xai key is missing", () => {
    expect(() =>
      resolveLlmProvider({
        env: { ...unsetEnv, LLM_PROVIDER: "xai", LLM_MODEL: "grok-x" },
        fetchFn,
      }),
    ).toThrow(LlmNotConfiguredError);
  });

  it("builds the openai provider when fully configured", () => {
    const provider = resolveLlmProvider({
      env: { ...unsetEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-x", LLM_MODEL: "gpt-x" },
      fetchFn,
    });
    expect(provider.name).toBe("openai");
  });

  it("builds the xai provider when fully configured", () => {
    const provider = resolveLlmProvider({
      env: { ...unsetEnv, LLM_PROVIDER: "xai", XAI_API_KEY: "xai-x", LLM_MODEL: "grok-x" },
      fetchFn,
    });
    expect(provider.name).toBe("xai");
  });

  it("selects by LLM_PROVIDER, not by which key happens to be set", () => {
    // Both keys present, provider=openai => openai (does not silently pick xai).
    const provider = resolveLlmProvider({
      env: {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-x",
        XAI_API_KEY: "xai-x",
        LLM_MODEL: "gpt-x",
      },
      fetchFn,
    });
    expect(provider.name).toBe("openai");
  });
});
