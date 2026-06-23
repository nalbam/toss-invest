"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ApiClientError } from "@/lib/client/hooks";
import {
  fetchMarketAdvisor,
  type MarketAdvisorInput,
  type MarketAdvisorResult,
} from "@/lib/client/market-advisor";
import { AdvisorAutoControls } from "./AdvisorAutoControls";
import { ChartOverlayControls } from "./ChartOverlayControls";
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
    typeof result.decision === "object" &&
    result.decision !== null &&
    (result.decision.action === "buy" ||
      result.decision.action === "sell" ||
      result.decision.action === "hold" ||
      result.decision.action === "wait") &&
    typeof result.decision.label === "string" &&
    typeof result.decision.reason === "string" &&
    typeof result.annotations === "object" &&
    result.annotations !== null &&
    Array.isArray(result.annotations.supportLevels) &&
    Array.isArray(result.annotations.resistanceLevels) &&
    Array.isArray(result.annotations.markers) &&
    typeof result.model === "string" &&
    typeof result.generatedAt === "string"
  );
}

export function MarketAiAdvisor({
  input,
  onResult,
  chartOverlay,
}: {
  input: MarketAdvisorInput;
  onResult?: (result: MarketAdvisorResult | undefined) => void;
  chartOverlay?: ComponentProps<typeof ChartOverlayControls>;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const requestSeqRef = useRef(0);
  const resultStorageKey = `${MARKET_ADVISOR_RESULT_KEY}:${input.symbol}:${input.interval}`;

  useEffect(() => {
    requestSeqRef.current += 1;
    const stored = readStoredJson(resultStorageKey, isMarketAdvisorResult);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
    onResult?.(stored ?? undefined);
  }, [onResult, resultStorageKey]);

  const run = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setState({ status: "loading" });
    try {
      const result = await fetchMarketAdvisor(input);
      if (seq !== requestSeqRef.current) return;
      writeStoredJson(resultStorageKey, result);
      setState({ status: "loaded", result });
      onResult?.(result);
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      const notConfigured =
        error instanceof ApiClientError && error.code === "advisor-not-configured";
      setState({
        status: "error",
        message: notConfigured
          ? "AI 어드바이저가 설정되지 않았습니다."
          : "시세 조언을 불러오지 못했습니다.",
      });
      onResult?.(undefined);
    }
  }, [input, onResult, resultStorageKey]);
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
          {chartOverlay ? <ChartOverlayControls {...chartOverlay} /> : null}
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
            <div
              className={`${styles.marketDecision} ${
                styles[`marketDecision${state.result.decision.action}`]
              }`}
            >
              <strong>{state.result.decision.label}</strong>
              <span>{state.result.decision.reason}</span>
            </div>
            <p className={styles.advisorAdvice}>{state.result.advice}</p>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
