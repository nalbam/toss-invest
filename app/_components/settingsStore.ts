"use client";

import { useSyncExternalStore } from "react";

// Synchronous string KV cache backed by the server's app_settings table. It
// mirrors the localStorage interface (getItem/setItem/removeItem over raw
// strings) so the existing storage seams (localStorageJson.ts and the direct
// callers in CollapsibleCard/MarketQuote/Dashboard/OrderForm) repoint to it
// without changing their value encodings.
//
// Reads are synchronous against an in-memory Map filled once by preloadSettings.
// Writes update the Map immediately and are flushed to the server in a single
// debounced, coalesced PUT. A hydration gate (useSettingsHydration) keeps the
// dashboard subtree from mounting until the cache is filled, so every component's
// sync read on mount sees the persisted value.

const SETTINGS_URL = "/api/settings";
const FLUSH_DELAY_MS = 400;

let cache = new Map<string, string>();
let hydrated = false;

const pendingUpserts = new Map<string, string>();
const pendingDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
let unloadFlushBound = false;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getStoredItem(key: string): string | null {
  return cache.has(key) ? (cache.get(key) as string) : null;
}

export function setStoredItem(key: string, value: string): void {
  cache.set(key, value);
  pendingDeletes.delete(key);
  pendingUpserts.set(key, value);
  scheduleFlush();
}

export function removeStoredItem(key: string): void {
  cache.delete(key);
  pendingUpserts.delete(key);
  pendingDeletes.add(key);
  scheduleFlush();
}

function takePendingPayload(): {
  upserts: { key: string; value: string }[];
  deletes: string[];
} | null {
  if (pendingUpserts.size === 0 && pendingDeletes.size === 0) {
    return null;
  }
  const upserts = Array.from(pendingUpserts, ([key, value]) => ({ key, value }));
  const deletes = Array.from(pendingDeletes);
  pendingUpserts.clear();
  pendingDeletes.clear();
  return { upserts, deletes };
}

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  bindUnloadFlush();
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_DELAY_MS);
}

async function flushNow(): Promise<void> {
  const payload = takePendingPayload();
  if (payload === null) return;
  try {
    await fetch(SETTINGS_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Best-effort persistence — matches the prior swallow-on-failure behavior of
    // localStorage writes. The in-memory cache already reflects the change.
  }
}

function bindUnloadFlush(): void {
  if (unloadFlushBound || typeof window === "undefined") return;
  unloadFlushBound = true;
  const flushOnExit = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const payload = takePendingPayload();
    if (payload === null) return;
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        SETTINGS_URL,
        new Blob([body], { type: "application/json" }),
      );
      return;
    }
    void fetch(SETTINGS_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  };
  window.addEventListener("pagehide", flushOnExit);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
  });
}

let preloadPromise: Promise<void> | null = null;

/**
 * Loads the full settings map into the cache once. Fails open: on any error the
 * cache stays empty and hydration still completes, so the app proceeds on its
 * in-code defaults rather than hanging the hydration gate.
 */
export function preloadSettings(): Promise<void> {
  if (preloadPromise !== null) return preloadPromise;
  if (hydrated) {
    preloadPromise = Promise.resolve();
    return preloadPromise;
  }
  preloadPromise = (async () => {
    try {
      const res = await fetch(SETTINGS_URL);
      const body: unknown = await res.json();
      const settings = (body as { data?: { settings?: unknown } })?.data
        ?.settings;
      if (settings && typeof settings === "object") {
        for (const [key, value] of Object.entries(
          settings as Record<string, unknown>,
        )) {
          if (typeof value === "string") cache.set(key, value);
        }
      }
    } catch {
      // Fail open — proceed with defaults.
    } finally {
      hydrated = true;
      notify();
    }
  })();
  return preloadPromise;
}

export function isSettingsHydrated(): boolean {
  return hydrated;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive hydration flag for the dashboard render gate. */
export function useSettingsHydration(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hydrated,
    () => false,
  );
}

// --- Test support -----------------------------------------------------------

export function __resetSettingsStore(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  cache = new Map();
  pendingUpserts.clear();
  pendingDeletes.clear();
  hydrated = false;
  preloadPromise = null;
  notify();
}

export function __seedSettings(record: Record<string, string>): void {
  for (const [key, value] of Object.entries(record)) {
    cache.set(key, value);
  }
  hydrated = true;
  notify();
}
