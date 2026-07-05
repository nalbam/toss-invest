"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/client/hooks";
import { readSessionJson, writeSessionJson } from "./sessionStorageJson";

// Shared async state machine for the on-demand advisor cards (AiAdvisor,
// MarketAiAdvisor). Both restore a cached result from sessionStorage on mount,
// trigger one fetch on `run`, persist + surface the result, and guard against
// out-of-order responses with a request sequence ref. The result cache is
// client-only (sessionStorage, per tab) so these large per-symbol blobs never
// accumulate in the server-synced settings store. The fetch/result types and the
// generic error message are the only per-domain differences.

export type AdvisorRunState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: T }
  | { status: "error"; message: string; notConfigured: boolean };

const NOT_CONFIGURED_MESSAGE = "AI 어드바이저가 설정되지 않았습니다.";

export interface UseAdvisorRunOptions<T> {
  /** sessionStorage key for the cached result; changing it reloads from storage. */
  storageKey: string;
  /** Type guard validating a stored/parsed result before use. */
  isResult: (value: unknown) => value is T;
  /** One advisor call. Wrap in useCallback so the run identity stays stable. */
  fetcher: () => Promise<T>;
  /** Message shown for failures other than advisor-not-configured. */
  errorMessage: string;
  /** Notified on mount restore, success, and failure. */
  onResult?: (result: T | undefined) => void;
  /**
   * Loads a server-persisted result when sessionStorage has no cache (new tab,
   * browser restart, account switch). Wrap in useCallback; resolve null for
   * "no result". Best-effort — a failure leaves the card idle.
   */
  restoreFallback?: () => Promise<T | null>;
}

export function useAdvisorRun<T>({
  storageKey,
  isResult,
  fetcher,
  errorMessage,
  onResult,
  restoreFallback,
}: UseAdvisorRunOptions<T>): {
  state: AdvisorRunState<T>;
  run: () => Promise<void>;
} {
  const [state, setState] = useState<AdvisorRunState<T>>({ status: "idle" });
  const requestSeqRef = useRef(0);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const seq = ++requestSeqRef.current;
    const stored = readSessionJson(storageKey, isResult);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
    onResultRef.current?.(stored ?? undefined);
    if (stored || !restoreFallback) {
      return;
    }
    // No per-tab cache: restore the last server-persisted result. The seq guard
    // drops the restore if a manual run (or a storageKey change) started since.
    void restoreFallback()
      .then((result) => {
        if (result === null || seq !== requestSeqRef.current) {
          return;
        }
        writeSessionJson(storageKey, result);
        setState({ status: "loaded", result });
        onResultRef.current?.(result);
      })
      .catch(() => {
        // Best-effort restore: stay idle so a manual run remains available.
      });
  }, [storageKey, isResult, restoreFallback]);

  const run = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setState({ status: "loading" });
    try {
      const result = await fetcher();
      if (seq !== requestSeqRef.current) return;
      writeSessionJson(storageKey, result);
      setState({ status: "loaded", result });
      onResultRef.current?.(result);
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      const notConfigured =
        error instanceof ApiClientError && error.code === "advisor-not-configured";
      setState({
        status: "error",
        notConfigured,
        message: notConfigured ? NOT_CONFIGURED_MESSAGE : errorMessage,
      });
      onResultRef.current?.(undefined);
    }
  }, [storageKey, fetcher, errorMessage]);

  return { state, run };
}
