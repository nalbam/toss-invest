"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/client/hooks";
import {
  fetchMarketAdvisor,
  type MarketAdvisorInput,
  type MarketAdvisorResult,
} from "@/lib/client/market-advisor";
import {
  AdvisorAutoControls,
  type AdvisorAutoInterval,
} from "./AdvisorAutoControls";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: MarketAdvisorResult }
  | { status: "error"; message: string };

const MARKET_ADVISOR_RESULT_KEY = "toss-invest:market-ai-advisor-result";

function isMarketAdvisorResult(value: unknown): value is MarketAdvisorResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Partial<MarketAdvisorResult>;
  return (
    typeof result.advice === "string" &&
    typeof result.model === "string" &&
    typeof result.generatedAt === "string"
  );
}

function readStoredResult(storageKey: string): MarketAdvisorResult | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isMarketAdvisorResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredResult(
  storageKey: string,
  result: MarketAdvisorResult,
): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(result));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function MarketAiAdvisor({ input }: { input: MarketAdvisorInput }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] =
    useState<AdvisorAutoInterval>(60_000);
  const resultStorageKey = `${MARKET_ADVISOR_RESULT_KEY}:${input.symbol}:${input.interval}`;

  useEffect(() => {
    const stored = readStoredResult(resultStorageKey);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
  }, [resultStorageKey]);

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await fetchMarketAdvisor(input);
      writeStoredResult(resultStorageKey, result);
      setState({ status: "loaded", result });
    } catch (error) {
      const notConfigured =
        error instanceof ApiClientError && error.code === "advisor-not-configured";
      setState({
        status: "error",
        message: notConfigured
          ? "AI 어드바이저가 설정되지 않았습니다."
          : "시세 조언을 불러오지 못했습니다.",
      });
    }
  }, [input, resultStorageKey]);

  useEffect(() => {
    if (!autoEnabled) {
      return;
    }
    const id = window.setInterval(() => {
      void run();
    }, autoIntervalMs);
    return () => window.clearInterval(id);
  }, [autoEnabled, autoIntervalMs, run]);

  return (
    <CollapsibleCard title="시세 AI 어드바이저" storageId="market-ai-advisor">
      <div className={styles.advisorBody}>
        <button
          type="button"
          className={styles.advisorRunButton}
          onClick={run}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "분석 중…" : "조언 받기"}
        </button>
        <AdvisorAutoControls
          enabled={autoEnabled}
          intervalMs={autoIntervalMs}
          onEnabledChange={setAutoEnabled}
          onIntervalChange={setAutoIntervalMs}
        />
        <p className={styles.advisorDisclaimer}>
          ※ 시세 AI 조언은 차트 데이터 기반 참고용입니다. 실제 주문은 직접 확인하세요.
        </p>

        {state.status === "error" ? (
          <p className={styles.advisorError}>{state.message}</p>
        ) : null}

        {state.status === "loaded" ? (
          <div className={styles.advisorResult}>
            <p className={styles.advisorAdvice}>{state.result.advice}</p>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
