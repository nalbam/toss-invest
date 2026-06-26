import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEtfAwareNewsSearch } from "./etf-aware";
import type { NewsItem } from "./types";

const inner = vi.fn();
const lookupSecurityType = vi.fn();
const extractConstituents = vi.fn();

function item(url: string, title = url): NewsItem {
  return { title, url, content: "" };
}

function makeSearch(maxResults?: number) {
  return createEtfAwareNewsSearch(inner, {
    lookupSecurityType,
    extractConstituents,
    ...(maxResults === undefined ? {} : { maxResults }),
  });
}

beforeEach(() => {
  inner.mockReset();
  lookupSecurityType.mockReset();
  extractConstituents.mockReset();
});

describe("createEtfAwareNewsSearch", () => {
  it("searches each constituent for an ETF and merges deduped by url", async () => {
    lookupSecurityType.mockResolvedValue("ETF");
    extractConstituents.mockResolvedValue(["삼성전자", "SK하이닉스"]);
    inner.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(
        query === "삼성전자"
          ? [item("u1"), item("u2")]
          : [item("u2"), item("u3")], // u2 duplicates across constituents
      ),
    );

    const items = await makeSearch()({
      query: "SOL AI반도체TOP2플러스",
      symbol: "0167A0",
      name: "SOL AI반도체TOP2플러스",
    });

    expect(extractConstituents).toHaveBeenCalledWith(
      "0167A0",
      "SOL AI반도체TOP2플러스",
    );
    // Constituents are searched as individual stocks under the news topic.
    expect(inner).toHaveBeenCalledWith({ query: "삼성전자", topic: "news" });
    expect(inner).toHaveBeenCalledWith({ query: "SK하이닉스", topic: "news" });
    expect(items.map((i) => i.url)).toEqual(["u1", "u2", "u3"]);
  });

  it("searches a non-ETF symbol under the news topic", async () => {
    lookupSecurityType.mockResolvedValue("STOCK");
    inner.mockResolvedValue([item("u")]);

    const input = { query: "삼성전자", symbol: "005930", name: "삼성전자" };
    await makeSearch()(input);

    expect(inner).toHaveBeenCalledWith({ ...input, topic: "news" });
    expect(extractConstituents).not.toHaveBeenCalled();
  });

  it("falls back to the ETF name (general topic) when extraction returns nothing", async () => {
    lookupSecurityType.mockResolvedValue("FOREIGN_ETF");
    extractConstituents.mockResolvedValue([]);
    inner.mockResolvedValue([]);

    const input = { query: "SOXL", symbol: "SOXL" };
    await makeSearch()(input);

    expect(inner).toHaveBeenCalledWith({ ...input, topic: "general" });
  });

  it("falls back to the general topic when the security-type lookup throws", async () => {
    lookupSecurityType.mockRejectedValue(new Error("boom"));
    inner.mockResolvedValue([]);

    const input = { query: "x", symbol: "y" };
    await makeSearch()(input);

    expect(inner).toHaveBeenCalledWith({ ...input, topic: "general" });
  });

  it("passes through untouched when no symbol is given", async () => {
    inner.mockResolvedValue([]);

    const input = { query: "x" };
    await makeSearch()(input);

    expect(inner).toHaveBeenCalledWith(input);
    expect(lookupSecurityType).not.toHaveBeenCalled();
  });

  it("ignores a failing per-constituent search instead of aborting", async () => {
    lookupSecurityType.mockResolvedValue("ETF");
    extractConstituents.mockResolvedValue(["a", "b"]);
    inner.mockImplementation(({ query }: { query: string }) =>
      query === "a"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve([item("u")]),
    );

    const items = await makeSearch()({ query: "etf", symbol: "e" });
    expect(items.map((i) => i.url)).toEqual(["u"]);
  });

  it("caps merged results at maxResults", async () => {
    lookupSecurityType.mockResolvedValue("ETF");
    extractConstituents.mockResolvedValue(["a"]);
    inner.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => item(`u${i}`)),
    );

    const items = await makeSearch(6)({ query: "etf", symbol: "e" });
    expect(items).toHaveLength(6);
  });
});
