import "server-only";
import { getEnv } from "@/lib/server/env";
import {
  getServerLlmProvider,
  LlmNotConfiguredError,
} from "@/lib/server/llm/container";
import { getServerTossClient } from "@/lib/server/toss/container";
import { createCachedNewsSearch } from "./cache";
import {
  createConstituentExtractor,
  type ConstituentExtractor,
} from "./constituents";
import {
  createEtfAwareNewsSearch,
  type SecurityTypeLookup,
} from "./etf-aware";
import { createTavilyNewsSearch } from "./tavily";
import type { NewsSearch } from "./types";

/**
 * Process-wide configured news search, assembled from validated env and the real
 * global `fetch`, wrapped in a 10-minute TTL cache and an ETF-aware decorator.
 * For ETF symbols it searches the top constituent stocks (via the LLM) instead
 * of the thin ETF-name results. Returns `null` when TAVILY_API_KEY is absent —
 * news is auxiliary context, so the advisor path falls back to chart-only
 * analysis (fail-open) instead of erroring the way the required LLM provider
 * does. When the LLM is unconfigured, ETF awareness is skipped and ETFs fall
 * back to searching the ETF name.
 */

// undefined = not yet resolved; null = resolved-but-unconfigured (no key).
let cached: NewsSearch | null | undefined;

export function getServerNewsSearch(): NewsSearch | null {
  if (cached === undefined) {
    cached = build();
  }
  return cached;
}

function build(): NewsSearch | null {
  const apiKey = getEnv().TAVILY_API_KEY;
  if (!apiKey) {
    return null;
  }
  const base = createCachedNewsSearch(
    createTavilyNewsSearch({
      apiKey,
      fetchFn: (url, init) => fetch(url, init),
    }),
  );
  const extractConstituents = resolveConstituentExtractor();
  if (extractConstituents === null) {
    return base;
  }
  return createEtfAwareNewsSearch(base, {
    lookupSecurityType: securityTypeLookup,
    extractConstituents,
  });
}

/** The LLM-backed extractor, or null when no LLM provider is configured. */
function resolveConstituentExtractor(): ConstituentExtractor | null {
  try {
    return createConstituentExtractor({ llmProvider: getServerLlmProvider() });
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return null;
    }
    throw error;
  }
}

/** Looks up a symbol's security type via Toss; a failure is treated as non-ETF. */
const securityTypeLookup: SecurityTypeLookup = async (symbol) => {
  try {
    const stocks = await getServerTossClient().getStocks({ symbols: [symbol] });
    return stocks[0]?.securityType ?? null;
  } catch {
    return null;
  }
};
