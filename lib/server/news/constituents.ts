import "server-only";
import { z } from "zod";
import type { LlmProvider } from "@/lib/server/llm/types";

// LLM-backed lookup of an ETF's top constituent stocks. Toss exposes no holdings
// data for ETFs, so the model supplies the largest holdings by weight, which the
// caller then searches news for. Mirrors the advisor's structured-output + zod
// re-validation pattern (the response is an untrusted boundary).

const MAX_CONSTITUENTS = 3;
const DEFAULT_TTL_MS = 21_600_000; // 6h — holdings change slowly.

const constituentsResponseSchema = z.object({
  constituents: z.array(z.object({ name: z.string().min(1) })).default([]),
});

// OpenAI-style structured-output schema (strict: every field required,
// additionalProperties false), matching the advisor's marketAdvisorJsonSchema.
const CONSTITUENTS_JSON_SCHEMA = {
  name: "etf_constituents",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      constituents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    },
    required: ["constituents"],
  },
} as const;

export type ConstituentExtractor = (
  symbol: string,
  name?: string,
) => Promise<string[]>;

export interface ConstituentExtractorOptions {
  llmProvider: LlmProvider;
  ttlMs?: number;
  /** Injectable clock (epoch ms) for deterministic TTL tests. */
  now?: () => number;
}

interface CacheEntry {
  names: string[];
  fetchedAt: number;
}

/**
 * Extracts an ETF's top constituent stock names via the LLM, cached per symbol.
 * The model returns the top 3 holdings as plain names (Korean for KR-listed
 * ETFs, English for US-listed), shaped by a JSON schema. The response is
 * untrusted, so it is zod-validated; a malformed/empty result yields []. A
 * provider/parse failure also yields [] but is NOT cached, so the next call
 * retries (mirrors `createCachedNewsSearch`). Results change slowly, so a
 * successful lookup is cached with a long TTL (6h by default). On [] the caller
 * falls back to searching the ETF name itself.
 */
export function createConstituentExtractor(
  options: ConstituentExtractorOptions,
): ConstituentExtractor {
  const { llmProvider } = options;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  return async (symbol, name) => {
    const at = now();
    const hit = cache.get(symbol);
    if (hit !== undefined && at - hit.fetchedAt < ttlMs) {
      return hit.names;
    }

    let names: string[];
    try {
      const label = name ? `${name} (${symbol})` : symbol;
      const response = await llmProvider.chat({
        messages: [
          {
            role: "system",
            content:
              "You identify the largest holdings of an ETF. Return only the top constituent stocks by weight as plain company/stock names — Korean names for Korea-listed ETFs, English names for US-listed ETFs. No tickers, no commentary.",
          },
          {
            role: "user",
            content: `ETF: ${label}\nReturn its top ${MAX_CONSTITUENTS} constituent stocks.`,
          },
        ],
        jsonSchema: CONSTITUENTS_JSON_SCHEMA,
        temperature: 0,
      });
      const parsed = constituentsResponseSchema.safeParse(
        JSON.parse(response.content),
      );
      names = parsed.success
        ? parsed.data.constituents
            .map((c) => c.name.trim())
            .filter((n) => n.length > 0)
            .slice(0, MAX_CONSTITUENTS)
        : [];
    } catch {
      // Provider error or unparseable JSON → empty, and do NOT cache so the
      // next call retries the upstream lookup.
      return [];
    }

    cache.set(symbol, { names, fetchedAt: at });
    return names;
  };
}
