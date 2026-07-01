"use client";

import { useEffect, useRef, useState } from "react";
import { isErrorEnvelope, isSuccessEnvelope } from "@/lib/client/envelope";
import {
  addFavoriteItem,
  removeFavoriteItem,
  useFavorites,
} from "@/lib/client/favorites";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

// A code-shaped query (no Korean/spaces) can fall back to a direct Toss lookup.
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-]+$/;

interface SearchResult {
  symbol: string;
  name: string;
  currency: string | null;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; results: SearchResult[] }
  | { status: "empty" }
  | { status: "error"; message: string };

interface DirectoryItem {
  symbol: string;
  name: string;
  currency: string | null;
}

interface StockInfoLite {
  symbol: string;
  name: string;
  currency: string | null;
}

/**
 * Symbol search + favorites modal. Searches the local name directory (seeded
 * from trusted Toss data); if the directory has no match and the query looks
 * like a symbol code, it falls back to a direct Toss code lookup (which also
 * seeds the directory). Results can be viewed or starred; favorites are listed
 * for quick re-selection.
 */
export function StockSearchModal({
  open,
  onClose,
  onSelectSymbol,
}: {
  open: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string, name?: string) => void;
}) {
  const { items: favorites, mutate } = useFavorites();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Keep the latest onClose without re-running the effects below, so a parent
  // re-render (e.g. polling) that passes a fresh onClose can't re-bind the
  // listener or steal focus back to the input while the user is interacting.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus the search field only when the modal transitions open.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Close on Escape while open; the listener is bound once per open.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return null;
  }

  function isFavorite(symbol: string): boolean {
    return favorites.some((item) => item.symbol === symbol);
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q === "") {
      return;
    }
    setSearch({ status: "loading" });
    try {
      // 1) Name/code search against the local directory.
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
      const body: unknown = await res.json();
      if (res.ok && isSuccessEnvelope<{ items: DirectoryItem[] }>(body)) {
        const items = body.data.items;
        if (items.length > 0) {
          setSearch({
            status: "results",
            results: items.map((i) => ({
              symbol: i.symbol,
              name: i.name,
              currency: i.currency,
            })),
          });
          return;
        }
      } else if (isErrorEnvelope(body)) {
        setSearch({ status: "error", message: "검색하지 못했습니다." });
        return;
      }

      // 2) Fallback: a code-shaped query → direct Toss lookup (also seeds dir).
      const code = q.toUpperCase();
      if (SYMBOL_PATTERN.test(code)) {
        const res2 = await fetch(
          `/api/stocks?symbols=${encodeURIComponent(code)}`,
        );
        const body2: unknown = await res2.json();
        if (
          res2.ok &&
          isSuccessEnvelope<StockInfoLite[]>(body2) &&
          body2.data.length > 0
        ) {
          const s = body2.data[0];
          setSearch({
            status: "results",
            results: [{ symbol: s.symbol, name: s.name, currency: s.currency }],
          });
          return;
        }
      }
      setSearch({ status: "empty" });
    } catch {
      setSearch({ status: "error", message: "검색하지 못했습니다." });
    }
  }

  async function toggleFavorite(result: SearchResult) {
    try {
      if (isFavorite(result.symbol)) {
        await removeFavoriteItem(result.symbol);
      } else {
        await addFavoriteItem({
          symbol: result.symbol,
          name: result.name,
          currency: result.currency ?? undefined,
        });
      }
      await mutate();
    } catch {
      // Best-effort; revalidation keeps the list consistent.
    }
  }

  function view(symbol: string, name?: string) {
    onSelectSymbol(symbol, name);
    onClose();
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="종목 검색"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <strong>종목 검색</strong>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <form className={styles.modalSearchRow} onSubmit={runSearch}>
          <input
            ref={inputRef}
            className={page.select}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="종목명 또는 코드 (예: 하이닉스, 000660)"
            aria-label="종목명 또는 코드"
          />
          <button type="submit" className={styles.modalSearchButton}>
            검색
          </button>
        </form>

        {search.status === "loading" ? (
          <p className={styles.advisorDisclaimer}>검색 중…</p>
        ) : search.status === "error" ? (
          <p className={styles.advisorError} role="alert">
            {search.message}
          </p>
        ) : search.status === "empty" ? (
          <p className={styles.advisorDisclaimer}>
            일치하는 종목이 없습니다. (이름 검색은 디렉터리에 등록된 종목만 —
            코드로 한 번 조회하면 이후 이름으로 찾을 수 있습니다)
          </p>
        ) : search.status === "results" ? (
          <ul className={styles.watchlistList}>
            {search.results.map((result) => (
              <li key={result.symbol} className={styles.watchlistItem}>
                <button
                  type="button"
                  className={styles.modalResultSelect}
                  onClick={() => view(result.symbol, result.name)}
                >
                  {result.name} ({result.symbol})
                </button>
                <button
                  type="button"
                  className={styles.favoriteStar}
                  aria-pressed={isFavorite(result.symbol)}
                  aria-label={
                    isFavorite(result.symbol) ? "즐겨찾기 해제" : "즐겨찾기 추가"
                  }
                  onClick={() => void toggleFavorite(result)}
                >
                  {isFavorite(result.symbol) ? "★" : "☆"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className={styles.modalFavorites}>
          <span className={styles.metricLabel}>즐겨찾기</span>
          {favorites.length === 0 ? (
            <p className={styles.advisorDisclaimer}>즐겨찾기한 종목이 없습니다.</p>
          ) : (
            <ul className={styles.watchlistList}>
              {favorites.map((item) => (
                <li key={item.id} className={styles.watchlistItem}>
                  <button
                    type="button"
                    className={styles.modalResultSelect}
                    onClick={() => view(item.symbol, item.name ?? undefined)}
                  >
                    {item.name ? `${item.name} (${item.symbol})` : item.symbol}
                  </button>
                  <button
                    type="button"
                    className={styles.watchlistRemove}
                    aria-label="즐겨찾기 해제"
                    onClick={() =>
                      void toggleFavorite({
                        symbol: item.symbol,
                        name: item.name ?? item.symbol,
                        currency: item.currency,
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
