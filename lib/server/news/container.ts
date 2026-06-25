import "server-only";
import { getEnv } from "@/lib/server/env";
import { createCachedNewsSearch } from "./cache";
import { createTavilyNewsSearch } from "./tavily";
import type { NewsSearch } from "./types";

/**
 * Process-wide configured news search, assembled from validated env and the real
 * global `fetch`, wrapped in a 10-minute TTL cache. Returns `null` when
 * TAVILY_API_KEY is absent — news is auxiliary context, so the advisor path
 * falls back to chart-only analysis (fail-open) instead of erroring the way the
 * required LLM provider does.
 */

// undefined = not yet resolved; null = resolved-but-unconfigured (no key).
let cached: NewsSearch | null | undefined;

export function getServerNewsSearch(): NewsSearch | null {
  if (cached === undefined) {
    const apiKey = getEnv().TAVILY_API_KEY;
    cached = apiKey
      ? createCachedNewsSearch(
          createTavilyNewsSearch({ apiKey, fetchFn: (url, init) => fetch(url, init) }),
        )
      : null;
  }
  return cached;
}
