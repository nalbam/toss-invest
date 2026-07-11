import { describe, expect, it, vi } from "vitest";
import { createCachedNewsSearch } from "./cache";
import type { NewsItem } from "./types";

const sample: NewsItem[] = [
  { title: "기사", url: "https://news.example.com/1", content: "요약" },
];

describe("createCachedNewsSearch", () => {
  it("serves a repeated query from cache within the TTL (one upstream call)", async () => {
    let clock = 1_000_000;
    const inner = vi.fn(async () => sample);
    const search = createCachedNewsSearch(inner, { ttlMs: 600_000, now: () => clock });

    const first = await search({ query: "삼성전자" });
    clock += 599_000; // still inside 10분
    const second = await search({ query: "삼성전자" });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("re-fetches once the TTL has elapsed", async () => {
    let clock = 1_000_000;
    const inner = vi.fn(async () => sample);
    const search = createCachedNewsSearch(inner, { ttlMs: 600_000, now: () => clock });

    await search({ query: "삼성전자" });
    clock += 600_000; // exactly at the boundary → expired (strict <)
    await search({ query: "삼성전자" });

    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("caches per query key (different symbols do not share)", async () => {
    const clock = 1_000_000;
    const inner = vi.fn(async () => sample);
    const search = createCachedNewsSearch(inner, { now: () => clock });

    await search({ query: "삼성전자" });
    await search({ query: "SK하이닉스" });

    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("caches per (query, topic) — the same query with a different topic is not shared", async () => {
    const clock = 1_000_000;
    const newsResult: NewsItem[] = [
      { title: "news topic", url: "https://news.example.com/news", content: "" },
    ];
    const generalResult: NewsItem[] = [
      { title: "general topic", url: "https://news.example.com/general", content: "" },
    ];
    const inner = vi
      .fn<() => Promise<NewsItem[]>>()
      .mockResolvedValueOnce(newsResult)
      .mockResolvedValueOnce(generalResult);
    const search = createCachedNewsSearch(inner, { now: () => clock });

    // Same query string, different topic (e.g. the ETF-aware decorator falling
    // back to "general" after an earlier "news" lookup for the same name).
    const first = await search({ query: "TIGER 200", topic: "news" });
    const second = await search({ query: "TIGER 200", topic: "general" });

    expect(inner).toHaveBeenCalledTimes(2);
    expect(first).toBe(newsResult);
    expect(second).toBe(generalResult);
  });

  it("does not cache a throw (the next call retries)", async () => {
    const clock = 1_000_000;
    const inner = vi
      .fn<() => Promise<NewsItem[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(sample);
    const search = createCachedNewsSearch(inner, { now: () => clock });

    await expect(search({ query: "삼성전자" })).rejects.toThrow("boom");
    const second = await search({ query: "삼성전자" });

    expect(inner).toHaveBeenCalledTimes(2);
    expect(second).toBe(sample);
  });

  it("caches an empty-result success (no repeated upstream call)", async () => {
    const clock = 1_000_000;
    const inner = vi.fn(async () => [] as NewsItem[]);
    const search = createCachedNewsSearch(inner, { now: () => clock });

    await search({ query: "무명종목" });
    await search({ query: "무명종목" });

    expect(inner).toHaveBeenCalledTimes(1);
  });
});
