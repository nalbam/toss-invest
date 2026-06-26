import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConstituentExtractor } from "./constituents";
import type { LlmProvider } from "@/lib/server/llm/types";

const chat = vi.fn();
const provider: LlmProvider = { name: "openai", chat };

function chatResult(constituents: { name: string }[]) {
  return { content: JSON.stringify({ constituents }), model: "test-model" };
}

beforeEach(() => {
  chat.mockReset();
});

describe("createConstituentExtractor", () => {
  it("extracts the top constituent names and requests structured output", async () => {
    chat.mockResolvedValue(
      chatResult([
        { name: "삼성전자" },
        { name: "SK하이닉스" },
        { name: "SK스퀘어" },
      ]),
    );
    const extract = createConstituentExtractor({ llmProvider: provider });

    const names = await extract("0167A0", "SOL AI반도체TOP2플러스");

    expect(names).toEqual(["삼성전자", "SK하이닉스", "SK스퀘어"]);
    // Structured output schema is requested.
    expect(chat.mock.calls[0][0].jsonSchema.name).toBe("etf_constituents");
  });

  it("caps the result at 3 constituents and trims blanks", async () => {
    chat.mockResolvedValue(
      chatResult([
        { name: " a " },
        { name: "b" },
        { name: "c" },
        { name: "d" },
      ]),
    );
    const extract = createConstituentExtractor({ llmProvider: provider });
    expect(await extract("X")).toEqual(["a", "b", "c"]);
  });

  it("caches per symbol within the TTL, refetching after it expires", async () => {
    chat.mockResolvedValue(chatResult([{ name: "NVIDIA" }]));
    let nowMs = 1000;
    const extract = createConstituentExtractor({
      llmProvider: provider,
      ttlMs: 60_000,
      now: () => nowMs,
    });

    await extract("SOXL");
    await extract("SOXL");
    expect(chat).toHaveBeenCalledTimes(1); // served from cache

    nowMs += 60_001;
    await extract("SOXL");
    expect(chat).toHaveBeenCalledTimes(2); // TTL expired → refetch
  });

  it("returns [] without caching on a provider failure (next call retries)", async () => {
    chat.mockRejectedValueOnce(new Error("boom"));
    const extract = createConstituentExtractor({ llmProvider: provider });

    expect(await extract("SOXL")).toEqual([]);

    chat.mockResolvedValueOnce(chatResult([{ name: "NVIDIA" }]));
    expect(await extract("SOXL")).toEqual(["NVIDIA"]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("returns [] on unparseable JSON", async () => {
    chat.mockResolvedValue({ content: "not json", model: "test-model" });
    const extract = createConstituentExtractor({ llmProvider: provider });
    expect(await extract("X")).toEqual([]);
  });
});
