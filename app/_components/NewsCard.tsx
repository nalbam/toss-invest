import type { NewsArticle } from "@/lib/client/types";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

/**
 * Source domain for an article URL — the hostname without a leading "www.".
 * Returns "" when the URL can't be parsed, so the caller can omit it. Pure for
 * unit testing.
 */
export function articleSource(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Formats an article's publish date as "YYYY-MM-DD" when parseable, else "".
 * Tavily's `publishedDate` format varies, so anything unparseable is dropped
 * rather than shown raw. Pure for unit testing.
 */
export function articleDate(publishedDate: string | undefined): string {
  if (publishedDate === undefined) {
    return "";
  }
  const ms = Date.parse(publishedDate);
  if (Number.isNaN(ms)) {
    return "";
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Recent news for the selected symbol — the same articles the AI advisor reads
 * as context. Each row is a titled external link with its source domain and
 * publish date. Renders an empty state when there are no articles (including
 * when news search is unconfigured, since the route then returns an empty list).
 */
export function NewsCard({
  articles,
  refreshing,
}: {
  articles: NewsArticle[];
  refreshing?: boolean;
}) {
  if (articles.length === 0) {
    return (
      <CollapsibleCard title="관련 뉴스" storageId="news" refreshing={refreshing}>
        <p className={styles.empty}>관련 뉴스 없음</p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard title="관련 뉴스" storageId="news" refreshing={refreshing}>
      <ul className={styles.newsList}>
        {articles.map((article) => {
          const source = articleSource(article.url);
          const date = articleDate(article.publishedDate);
          return (
            <li key={article.url} className={styles.newsItem}>
              <a
                className={styles.newsTitle}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {article.title}
              </a>
              {source || date ? (
                <span className={styles.newsMeta}>
                  {source}
                  {source && date ? <span aria-hidden="true"> · </span> : null}
                  {date}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </CollapsibleCard>
  );
}
