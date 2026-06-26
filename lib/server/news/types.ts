import "server-only";

/**
 * Provider-agnostic news search contract for the market (chart) advisor. One
 * search returns recent articles for a symbol, folded into the LLM prompt as
 * auxiliary market-sentiment context. Mirrors the LLM layer's DI shape so the
 * implementation is swappable and tests stay deterministic.
 */

export interface NewsItem {
  title: string;
  url: string;
  /** Short snippet/summary of the article (may be empty). */
  content: string;
  /** Publish date when the source provides one. */
  publishedDate?: string;
}

export interface NewsSearchInput {
  /** Free-text search query (a symbol's name, a constituent name, etc.). */
  query: string;
  /**
   * The originating symbol, when known. Used by the ETF-aware decorator to look
   * up the security type and, for ETFs, search the constituents instead. The
   * base (Tavily) search ignores it and uses only `query`.
   */
  symbol?: string;
  /** The symbol's display name, when known (passed to constituent extraction). */
  name?: string;
  /**
   * Tavily search topic. "news" surfaces real articles and is best for
   * individual stocks (incl. ETF constituents); "general" matches an instrument
   * by its full name and is used as the ETF-name fallback. Defaults to "news".
   */
  topic?: "news" | "general";
}

export type NewsSearch = (input: NewsSearchInput) => Promise<NewsItem[]>;

/** Injected fetch (DI), mirroring the LLM/toss layers so tests stay deterministic. */
export type NewsFetchFn = (url: string, init: RequestInit) => Promise<Response>;
