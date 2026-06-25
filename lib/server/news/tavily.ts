import "server-only";
import { z } from "zod";
import type { NewsFetchFn, NewsItem, NewsSearch } from "./types";

// Tavily Search API adapter (https://api.tavily.com/search). One POST per query
// asks for recent news; the response is an untrusted boundary, so it is
// zod-parsed and malformed results are dropped rather than trusted. Mirrors the
// LLM adapter's fetch DI + AbortController timeout pattern (lib/server/llm).

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;
const RECENT_DAYS = 7;

export interface TavilyNewsConfig {
  apiKey: string;
  fetchFn: NewsFetchFn;
  /** Cost/latency guard: aborts the request after this many ms. */
  timeoutMs?: number;
}

// Tavily returns more fields than we need; keep only what the prompt uses and
// tolerate missing content / extra fields. A result missing title/url is dropped.
const tavilyResultSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  content: z.string().default(""),
  published_date: z.string().optional(),
});

const tavilyResponseSchema = z.object({
  results: z.array(z.unknown()).optional(),
});

export function createTavilyNewsSearch(config: TavilyNewsConfig): NewsSearch {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async ({ query }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await config.fetchFn(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          query,
          topic: "news",
          search_depth: "basic",
          max_results: MAX_RESULTS,
          days: RECENT_DAYS,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Status only — never echo the query or the api key.
      throw new Error(`tavily search failed with status ${response.status}`);
    }

    const parsed = tavilyResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.results) {
      return [];
    }
    const items: NewsItem[] = [];
    for (const raw of parsed.data.results) {
      const result = tavilyResultSchema.safeParse(raw);
      if (!result.success) {
        continue;
      }
      items.push({
        title: result.data.title,
        url: result.data.url,
        content: result.data.content,
        publishedDate: result.data.published_date,
      });
    }
    return items;
  };
}
