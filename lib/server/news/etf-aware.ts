import "server-only";
import type { ConstituentExtractor } from "./constituents";
import type { NewsItem, NewsSearch } from "./types";

// Decorator that makes a NewsSearch ETF-aware. ETFs have little direct news, so
// for an ETF symbol the top constituent stocks are searched instead and merged.
// Everything else (non-ETF symbols, and any failure) falls back to the inner
// search of the original query.

const ETF_SECURITY_TYPES: ReadonlySet<string> = new Set([
  "ETF",
  "FOREIGN_ETF",
]);
const DEFAULT_MAX_RESULTS = 6;

/** Resolves a symbol's security type, or null when unknown/unavailable. */
export type SecurityTypeLookup = (symbol: string) => Promise<string | null>;

export interface EtfAwareNewsOptions {
  lookupSecurityType: SecurityTypeLookup;
  extractConstituents: ConstituentExtractor;
  /** Cap on merged constituent articles (default 6). */
  maxResults?: number;
}

/**
 * Wraps a NewsSearch so an ETF symbol is searched by its top constituent stocks
 * rather than the ETF name. For a symbol whose security type is ETF/FOREIGN_ETF,
 * the constituents are extracted and each searched via `inner` in parallel, then
 * merged and deduped by url (capped at `maxResults`). A non-ETF symbol, a
 * lookup/extraction failure, or an empty constituent list all fall back to
 * `inner({ query })`. News is auxiliary, so the ETF path never throws — a failed
 * per-constituent search contributes nothing instead of aborting the rest.
 */
export function createEtfAwareNewsSearch(
  inner: NewsSearch,
  options: EtfAwareNewsOptions,
): NewsSearch {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  return async (input) => {
    if (input.symbol === undefined) {
      return inner(input);
    }

    let securityType: string | null = null;
    try {
      securityType = await options.lookupSecurityType(input.symbol);
    } catch {
      securityType = null;
    }

    if (securityType !== null && ETF_SECURITY_TYPES.has(securityType)) {
      let constituents: string[] = [];
      try {
        constituents = await options.extractConstituents(input.symbol, input.name);
      } catch {
        constituents = [];
      }
      if (constituents.length > 0) {
        // Constituents are individual stocks → "news" surfaces real articles.
        const perConstituent = await Promise.all(
          constituents.map((stock) =>
            inner({ query: stock, topic: "news" }).catch(() => [] as NewsItem[]),
          ),
        );
        return dedupeByUrl(perConstituent.flat()).slice(0, maxResults);
      }
      // No constituents → fall back to the ETF name; "general" matches the fund.
      return inner({ ...input, topic: "general" });
    }

    // Individual stock → "news" (real articles). Unknown type (lookup failed) →
    // "general", which keeps results on-symbol whether it's a stock or an ETF.
    return inner({ ...input, topic: securityType === null ? "general" : "news" });
  };
}

/** Keeps the first NewsItem per url, preserving order. */
function dedupeByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    if (seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
