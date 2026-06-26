// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NewsCard, articleDate, articleSource } from "./NewsCard";
import type { NewsArticle } from "@/lib/client/types";

afterEach(() => {
  cleanup();
});

/** Matches an element whose full textContent equals `t` (meta line split by spans). */
const byText =
  (t: string) =>
  (_: string, el: Element | null): boolean =>
    el?.textContent === t;

const sample: NewsArticle[] = [
  {
    title: "SK하이닉스 신고가 경신",
    url: "https://www.example.com/news/1",
    content: "본문 요약",
    publishedDate: "2026-06-20T08:00:00Z",
  },
  {
    title: "반도체 업황 회복 신호",
    url: "https://news.site.co.kr/article/2",
    content: "",
  },
];

describe("articleSource", () => {
  it("returns the hostname without a leading www.", () => {
    expect(articleSource("https://www.example.com/news/1")).toBe("example.com");
    expect(articleSource("https://news.site.co.kr/article/2")).toBe(
      "news.site.co.kr",
    );
  });

  it("returns an empty string for an unparseable url", () => {
    expect(articleSource("not a url")).toBe("");
  });
});

describe("articleDate", () => {
  it("formats a parseable date as YYYY-MM-DD", () => {
    expect(articleDate("2026-06-20T08:00:00Z")).toBe("2026-06-20");
  });

  it("returns an empty string for undefined or unparseable input", () => {
    expect(articleDate(undefined)).toBe("");
    expect(articleDate("not a date")).toBe("");
  });
});

describe("NewsCard", () => {
  it("renders each article as an external link with source and date", () => {
    render(<NewsCard articles={sample} />);

    const link = screen.getByRole("link", { name: "SK하이닉스 신고가 경신" });
    expect(link).toHaveAttribute("href", "https://www.example.com/news/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Source domain + publish date are shown together on the meta line.
    expect(
      screen.getByText(byText("example.com · 2026-06-20")),
    ).toBeInTheDocument();
    // The second article has no date, so only its source shows.
    expect(screen.getByText("news.site.co.kr")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders an empty state when there are no articles", () => {
    render(<NewsCard articles={[]} />);
    expect(screen.getByText("관련 뉴스 없음")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
