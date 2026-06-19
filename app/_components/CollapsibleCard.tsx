"use client";

import { useEffect, useId, useState } from "react";
import styles from "./dashboard.module.css";

const STORAGE_PREFIX = "toss-invest:collapsed:";

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readStoredCollapsed(key: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(storageKey(key));
    if (stored === "true") return true;
    if (stored === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredCollapsed(key: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(storageKey(key), String(collapsed));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function CollapsibleCard({
  title,
  storageId,
  summary,
  children,
}: {
  title: string;
  storageId: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = readStoredCollapsed(storageId);
    if (stored !== null) {
      setCollapsed(stored);
    }
  }, [storageId]);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      writeStoredCollapsed(storageId, next);
      return next;
    });
  }

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardHeader}>
        <h2 id={titleId} className={styles.cardTitle}>
          <button
            type="button"
            className={styles.cardToggle}
            aria-expanded={!collapsed}
            onClick={toggle}
          >
            <span>{title}</span>
            <span className={styles.cardToggleIcon} aria-hidden="true">
              {collapsed ? "▸" : "▾"}
            </span>
          </button>
        </h2>
      </div>
      {collapsed ? (
        summary === undefined ? null : (
          <div className={styles.collapsedSummary}>{summary}</div>
        )
      ) : (
        children
      )}
    </section>
  );
}
