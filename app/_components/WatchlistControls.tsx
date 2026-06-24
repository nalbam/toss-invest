"use client";

import { useState } from "react";
import { CHART_INTERVALS } from "@/lib/client/candles";
import {
  removeWatchlistItem,
  setWatchlistItemEnabled,
  useWatchlist,
} from "@/lib/client/watchlist";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

const MUTATE_ERROR_MESSAGE = "변경을 저장하지 못했습니다. 다시 시도해 주세요.";

/**
 * Read/manage view of the background advisor watchlist. Entries are added/edited
 * from the market advisor card (current symbol+chart); here they are listed with
 * their chart interval and analysis period, and can be toggled on/off or removed.
 */
export function WatchlistControls() {
  const { items, mutate, isLoading } = useWatchlist();
  const [error, setError] = useState<string | null>(null);

  async function handleRemove(id: number) {
    setError(null);
    try {
      await removeWatchlistItem(id);
      await mutate();
    } catch {
      setError(MUTATE_ERROR_MESSAGE);
    }
  }

  async function handleToggle(id: number, enabled: boolean) {
    setError(null);
    try {
      await setWatchlistItemEnabled(id, !enabled);
      await mutate();
    } catch {
      setError(MUTATE_ERROR_MESSAGE);
    }
  }

  function intervalLabel(value: string): string {
    return CHART_INTERVALS.find((item) => item.value === value)?.label ?? value;
  }

  function periodLabel(minutes: number): string {
    if (minutes % 1440 === 0) {
      return `${minutes / 1440}일마다`;
    }
    if (minutes % 60 === 0) {
      return `${minutes / 60}시간마다`;
    }
    return `${minutes}분마다`;
  }

  return (
    <CollapsibleCard title="자동 분석 종목" storageId="advisor-watchlist">
      <div className={styles.watchlistBody}>
        <p className={styles.advisorDisclaimer}>
          ※ 시세 AI 어드바이저에서 종목·차트의 자동분석을 켜면 여기에 등록됩니다.
        </p>

        {error ? (
          <p className={styles.advisorError} role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className={page.status}>불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className={styles.advisorDisclaimer}>등록된 종목이 없습니다.</p>
        ) : (
          <ul className={styles.watchlistList}>
            {items.map((item) => (
              <li key={item.id} className={styles.watchlistItem}>
                <button
                  type="button"
                  className={styles.watchlistToggle}
                  aria-pressed={item.enabled}
                  onClick={() => void handleToggle(item.id, item.enabled)}
                  title={item.enabled ? "분석 켜짐" : "분석 꺼짐"}
                >
                  {item.enabled ? "🟢" : "⚪"}
                </button>
                <span className={styles.watchlistSymbol}>
                  {item.name ? `${item.name} (${item.symbol})` : item.symbol}
                </span>
                <span className={styles.watchlistInterval}>
                  {intervalLabel(item.interval)} · {periodLabel(item.runEveryMinutes)}
                </span>
                <button
                  type="button"
                  className={styles.watchlistRemove}
                  onClick={() => void handleRemove(item.id)}
                  aria-label="삭제"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CollapsibleCard>
  );
}
