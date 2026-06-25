"use client";

import { useCallback, useState, type ComponentProps } from "react";
import { useSWRConfig } from "swr";
import {
  fetchMarketAdvisor,
  loadAdvisorCandles,
  type MarketAdvisorInput,
} from "@/lib/client/market-advisor";
import type { ChartInterval } from "@/lib/client/candles";
import {
  ApiClientError,
  marketAdvisorHistoryKey,
  useMarketAdvisorHistory,
} from "@/lib/client/hooks";
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

const DEFAULT_RUN_EVERY_MS = 900_000; // 15분
const NOT_CONFIGURED_MESSAGE = "AI 어드바이저가 설정되지 않았습니다.";
const RUN_ERROR_MESSAGE = "시세 조언을 불러오지 못했습니다.";
const AUTO_ERROR_MESSAGE = "자동분석 설정을 저장하지 못했습니다. 다시 시도해 주세요.";

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

/** Formats an ISO timestamp as `YYYY-MM-DD HH:mm` in the viewer's local time. */
function formatAdviceTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function MarketAiAdvisor({
  input,
  chartOverlay,
}: {
  input: MarketAdvisorInput;
  chartOverlay?: ComponentProps<typeof ChartOverlayControls>;
}) {
  const { mutate } = useSWRConfig();
  // The box reflects the latest persisted advice (manual run OR background
  // worker), not a client-cached manual result — both sources write to the same
  // history, so the displayed decision always matches the chart's advice line.
  const history = useMarketAdvisorHistory(input.symbol, input.interval);
  const latest = history.data?.events[0];
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const run = useCallback(async () => {
    setRunState({ status: "loading" });
    try {
      // Pull an interval-appropriate candle window (not just the visible page) so
      // e.g. a 10m chart is analyzed on enough ten-minute bars, then persist.
      const candles = await loadAdvisorCandles(
        input.symbol,
        input.interval as ChartInterval,
      );
      await fetchMarketAdvisor({ ...input, candles });
      await mutate(marketAdvisorHistoryKey(input.symbol, input.interval));
      setRunState({ status: "idle" });
    } catch (error) {
      const notConfigured =
        error instanceof ApiClientError && error.code === "advisor-not-configured";
      setRunState({
        status: "error",
        message: notConfigured ? NOT_CONFIGURED_MESSAGE : RUN_ERROR_MESSAGE,
      });
    }
  }, [input, mutate]);

  // The auto-analyze indicator drives the server-side background watchlist:
  // toggling/changing the period registers/updates this {symbol, interval}.
  const { items, mutate: mutateWatchlist } = useWatchlist();
  const current = items.find(
    (item) => item.symbol === input.symbol && item.interval === input.interval,
  );
  const [pendingIntervalMs, setPendingIntervalMs] = useState(DEFAULT_RUN_EVERY_MS);
  const [autoError, setAutoError] = useState<string | null>(null);
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
    setAutoError(null);
    try {
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
      await mutateWatchlist();
    } catch {
      setAutoError(AUTO_ERROR_MESSAGE);
    }
  }

  async function handleAutoIntervalChange(intervalMs: number) {
    setPendingIntervalMs(intervalMs);
    if (!current) {
      return;
    }
    setAutoError(null);
    try {
      await setWatchlistItemRunEvery(current.id, Math.round(intervalMs / 60_000));
      await mutateWatchlist();
    } catch {
      setAutoError(AUTO_ERROR_MESSAGE);
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
            disabled={runState.status === "loading"}
          >
            {runState.status === "loading" ? "분석 중…" : "조언 받기"}
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

        {runState.status === "error" ? (
          <p className={styles.advisorError}>{runState.message}</p>
        ) : null}

        {autoError ? (
          <p className={styles.advisorError} role="alert">
            {autoError}
          </p>
        ) : null}

        {latest ? (
          <div className={styles.advisorResult}>
            <div
              className={`${styles.marketDecision} ${
                styles[`marketDecision${latest.decision.action}`]
              }`}
            >
              <strong>{latest.decision.label}</strong>
              <span>{latest.decision.reason}</span>
            </div>
            <p className={styles.advisorAdvice}>{latest.advice}</p>
            <p className={styles.advisorTimestamp}>
              조언 일시: {formatAdviceTime(latest.generatedAt)}
            </p>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
