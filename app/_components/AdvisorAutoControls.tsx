import type { CSSProperties } from "react";
import styles from "./dashboard.module.css";

export const ADVISOR_AUTO_INTERVALS = [
  { label: "1분", value: 60_000 },
  { label: "2분", value: 120_000 },
  { label: "3분", value: 180_000 },
  { label: "5분", value: 300_000 },
  { label: "10분", value: 600_000 },
  { label: "30분", value: 1_800_000 },
  { label: "1시간", value: 3_600_000 },
] as const;

// Background analysis periods (ms) for the market advisor: minute → day, so a
// daily chart can be analyzed e.g. once a day instead of every minute.
export const ANALYSIS_INTERVALS = [
  { label: "1분", value: 60_000 },
  { label: "5분", value: 300_000 },
  { label: "15분", value: 900_000 },
  { label: "30분", value: 1_800_000 },
  { label: "1시간", value: 3_600_000 },
  { label: "4시간", value: 14_400_000 },
  { label: "1일", value: 86_400_000 },
] as const;

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
