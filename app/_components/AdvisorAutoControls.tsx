import type { CSSProperties } from "react";
import { MINUTE_CHART_INTERVALS } from "@/lib/client/candles";
import styles from "./dashboard.module.css";

// 차트 분봉과 동일한 분 단위 옵션(ms). 분봉 목록을 단일 출처로 파생해, 차트
// 분봉이 바뀌면 조언 인터벌도 같은 시간대를 따라간다.
const MINUTE_INTERVALS = MINUTE_CHART_INTERVALS.map(({ value, label }) => ({
  label,
  value: parseInt(value, 10) * 60_000,
}));

// 개별 종목 조언 자동 재실행 주기 — 차트 분봉과 동일.
export const ADVISOR_AUTO_INTERVALS = MINUTE_INTERVALS;

// 시장 advisor 배경 분석 주기 — 차트 분봉 + 일봉(하루 한 번).
export const ANALYSIS_INTERVALS = [
  ...MINUTE_INTERVALS,
  { label: "1일", value: 86_400_000 },
];

export type AdvisorAutoInterval = number;

function spinnerDuration(intervalMs: number): string {
  return `${Math.max(1, intervalMs / 300_000)}s`;
}

function progressDegrees(remainingRatio: number): string {
  return `${Math.max(0, Math.min(1, remainingRatio)) * 360}deg`;
}

export function AdvisorAutoControls({
  enabled,
  intervalMs,
  remainingRatio,
  onEnabledChange,
  onIntervalChange,
  intervals = ADVISOR_AUTO_INTERVALS,
}: {
  enabled: boolean;
  intervalMs: number;
  remainingRatio: number;
  onEnabledChange: (enabled: boolean) => void;
  onIntervalChange: (intervalMs: number) => void;
  intervals?: ReadonlyArray<{ label: string; value: number }>;
}) {
  return (
    <div className={styles.advisorControls}>
      <button
        type="button"
        className={`${styles.advisorAutoButton} ${
          enabled ? styles.advisorAutoButtonActive : ""
        }`}
        aria-pressed={enabled}
        aria-label="자동 재실행 활성화"
        title="자동 재실행 활성화"
        style={
          {
            "--advisor-spin-duration": spinnerDuration(intervalMs),
            "--advisor-progress-deg": progressDegrees(remainingRatio),
          } as CSSProperties
        }
        onClick={() => onEnabledChange(!enabled)}
      >
        <span className={styles.advisorAutoSpinner} aria-hidden="true" />
      </button>
      <select
        className={styles.advisorIntervalSelect}
        value={intervalMs}
        onChange={(event) => onIntervalChange(Number(event.target.value))}
        disabled={!enabled}
        aria-label="자동 재실행 주기"
      >
        {intervals.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
