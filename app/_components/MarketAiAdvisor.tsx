"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/client/hooks";
import {
  fetchMarketAdvisor,
  type MarketAdvisorInput,
  type MarketAdvisorResult,
} from "@/lib/client/market-advisor";
import { AdvisorAutoControls } from "./AdvisorAutoControls";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";
import { readStoredJson, writeStoredJson } from "./localStorageJson";
import { useAdvisorAutoRerun } from "./useAdvisorAutoRerun";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: MarketAdvisorResult }
  | { status: "error"; message: string };

const MARKET_ADVISOR_RESULT_KEY = "toss-invest:market-ai-advisor-result";
const MARKET_ADVISOR_AUTO_KEY = "toss-invest:market-ai-advisor-auto";

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

export function MarketAiAdvisor({ input }: { input: MarketAdvisorInput }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const resultStorageKey = `${MARKET_ADVISOR_RESULT_KEY}:${input.symbol}:${input.interval}`;

  useEffect(() => {
    const stored = readStoredJson(resultStorageKey, isMarketAdvisorResult);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
  }, [resultStorageKey]);

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await fetchMarketAdvisor(input);
      writeStoredJson(resultStorageKey, result);
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
  const {
    autoEnabled,
    autoIntervalMs,
    autoRemainingRatio,
    setAutoEnabled,
    setAutoIntervalMs,
  } = useAdvisorAutoRerun(run, MARKET_ADVISOR_AUTO_KEY);

  return (
    <CollapsibleCard title="시세 AI 어드바이저" storageId="market-ai-advisor">
      <div className={styles.advisorBody}>
        <div className={styles.advisorActionRow}>
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
            remainingRatio={autoRemainingRatio}
            onEnabledChange={setAutoEnabled}
            onIntervalChange={setAutoIntervalMs}
          />
        </div>
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
