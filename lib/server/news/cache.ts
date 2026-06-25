import "server-only";
import type { NewsItem, NewsSearch } from "./types";

// Per-query in-memory TTL cache for symbol news. A repeated {query} within
// `ttlMs` is served from memory (one upstream call). The container shares a
// single process-wide instance across the manual route and the background
// worker, so the same symbol within the window costs one Tavily call total.

const DEFAULT_TTL_MS = 600_000; // 10분

export interface CachedNewsSearchOptions {
  ttlMs?: number;
  /** Injectable clock (epoch ms) for deterministic TTL tests. */
  now?: () => number;
}

interface CacheEntry {
  news: NewsItem[];
  fetchedAt: number;
}

/**
 * Wraps a NewsSearch with a per-query TTL cache. Only successful results (an
 * empty array included) are cached; a throw is NOT cached, so the next call
 * retries the upstream search.
 */
export function createCachedNewsSearch(
  inner: NewsSearch,
  options?: CachedNewsSearchOptions,
): NewsSearch {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const now = options?.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  return async (input) => {
    const key = input.query;
    const at = now();
    const hit = cache.get(key);
    if (hit !== undefined && at - hit.fetchedAt < ttlMs) {
      return hit.news;
    }
    const news = await inner(input);
    cache.set(key, { news, fetchedAt: at });
    return news;
  };
}
