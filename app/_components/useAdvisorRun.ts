"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/client/hooks";
import { readStoredJson, writeStoredJson } from "./localStorageJson";

// Shared async state machine for the on-demand advisor cards (AiAdvisor,
// MarketAiAdvisor). Both restore a cached result from localStorage on mount,
// trigger one fetch on `run`, persist + surface the result, and guard against
// out-of-order responses with a request sequence ref. The fetch/result types and
// the generic error message are the only per-domain differences.

export type AdvisorRunState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: T }
  | { status: "error"; message: string; notConfigured: boolean };

const NOT_CONFIGURED_MESSAGE = "AI 어드바이저가 설정되지 않았습니다.";

export interface UseAdvisorRunOptions<T> {
  /** localStorage key for the cached result; changing it reloads from storage. */
  storageKey: string;
  /** Type guard validating a stored/parsed result before use. */
  isResult: (value: unknown) => value is T;
  /** One advisor call. Wrap in useCallback so the run identity stays stable. */
  fetcher: () => Promise<T>;
  /** Message shown for failures other than advisor-not-configured. */
  errorMessage: string;
  /** Notified on mount restore, success, and failure. */
  onResult?: (result: T | undefined) => void;
}

export function useAdvisorRun<T>({
  storageKey,
  isResult,
  fetcher,
  errorMessage,
  onResult,
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
    requestSeqRef.current += 1;
    const stored = readStoredJson(storageKey, isResult);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
    onResultRef.current?.(stored ?? undefined);
  }, [storageKey, isResult]);

  const run = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setState({ status: "loading" });
    try {
      const result = await fetcher();
      if (seq !== requestSeqRef.current) return;
      writeStoredJson(storageKey, result);
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
