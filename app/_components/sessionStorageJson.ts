"use client";

// JSON-over-sessionStorage helpers for client-only, per-tab caches that must NOT
// sync to the server settings store — e.g. large advisor result blobs that would
// otherwise accumulate one row per symbol/interval in `app_settings`. Survives a
// reload within the tab; cleared when the tab closes. Guarded for SSR and for
// private/restricted browser contexts where sessionStorage throws.

export function readSessionJson<T>(
  storageKey: string,
  isValid: (value: unknown) => value is T,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSessionJson(storageKey: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // sessionStorage can be unavailable in private or restricted browser contexts.
  }
}
