"use client";

import { useCallback, useState, type ComponentProps } from "react";
import {
  fetchMarketAdvisor,
  type MarketAdvisorInput,
  type MarketAdvisorResult,
} from "@/lib/client/market-advisor";
import {
  addWatchlistItem,
  removeWatchlistItem,
  setWatchlistItemRunEvery,
  useWatchlist,
} from "@/lib/client/watchlist";
import { AdvisorAutoControls, ANALYSIS_INTERVALS } from "./AdvisorAutoControls";
import { ChartOverlayControls } from "./ChartOverlayControls";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";
import { useAdvisorRun } from "./useAdvisorRun";

const MARKET_ADVISOR_RESULT_KEY = "toss-invest:market-ai-advisor-result";
const DEFAULT_RUN_EVERY_MS = 900_000; // 15분

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
  const resultStorageKey = `${MARKET_ADVISOR_RESULT_KEY}:${input.symbol}:${input.interval}`;
  const fetcher = useCallback(() => fetchMarketAdvisor(input), [input]);
  const { state, run } = useAdvisorRun<MarketAdvisorResult>({
    storageKey: resultStorageKey,
    isResult: isMarketAdvisorResult,
    fetcher,
    errorMessage: "시세 조언을 불러오지 못했습니다.",
    onResult,
  });

  // The auto-analyze indicator now drives the server-side background watchlist:
  // toggling/changing the period registers/updates this {symbol, interval}.
  const { items, mutate } = useWatchlist();
  const current = items.find(
    (item) => item.symbol === input.symbol && item.interval === input.interval,
  );
  const [pendingIntervalMs, setPendingIntervalMs] = useState(DEFAULT_RUN_EVERY_MS);
  const autoEnabled = current?.enabled ?? false;
  const autoIntervalMs = current ? current.runEveryMinutes * 60_000 : pendingIntervalMs;
  const autoRemainingRatio = (() => {
    if (!current?.enabled) {
      return 0;
    }
    if (current.lastRunAt === null) {
      return 1;
    }
    const total = current.runEveryMinutes * 60_000;
    const elapsed = Date.now() - Date.parse(current.lastRunAt);
    return Math.max(0, Math.min(1, 1 - elapsed / total));
  })();

  async function handleAutoEnabledChange(next: boolean) {
    if (next) {
      await addWatchlistItem({
        symbol: input.symbol,
        name: input.name,
        interval: input.interval,
        currency: input.currency,
        runEveryMinutes: Math.round(autoIntervalMs / 60_000),
      });
    } else if (current) {
      await removeWatchlistItem(current.id);
    }
    await mutate();
  }

  async function handleAutoIntervalChange(intervalMs: number) {
    setPendingIntervalMs(intervalMs);
    if (current) {
      await setWatchlistItemRunEvery(current.id, Math.round(intervalMs / 60_000));
      await mutate();
    }
  }

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
            onEnabledChange={(next) => void handleAutoEnabledChange(next)}
            onIntervalChange={(ms) => void handleAutoIntervalChange(ms)}
            intervals={ANALYSIS_INTERVALS}
          />
        </div>
        <p className={styles.advisorDisclaimer}>
          ※ 시세 AI 조언은 차트 데이터 기반 참고용입니다. 자동분석은 서버 백그라운드에서 주기적으로 실행됩니다.
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
