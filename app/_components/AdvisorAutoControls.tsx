import styles from "./dashboard.module.css";

export const ADVISOR_AUTO_INTERVALS = [
  { label: "1분", value: 60_000 },
  { label: "5분", value: 300_000 },
  { label: "10분", value: 600_000 },
  { label: "30분", value: 1_800_000 },
  { label: "1시간", value: 3_600_000 },
] as const;

export type AdvisorAutoInterval = (typeof ADVISOR_AUTO_INTERVALS)[number]["value"];

export function AdvisorAutoControls({
  enabled,
  intervalMs,
  onEnabledChange,
  onIntervalChange,
}: {
  enabled: boolean;
  intervalMs: AdvisorAutoInterval;
  onEnabledChange: (enabled: boolean) => void;
  onIntervalChange: (intervalMs: AdvisorAutoInterval) => void;
}) {
  return (
    <div className={styles.advisorControls}>
      <label className={styles.advisorAutoToggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        자동 재실행 활성화
      </label>
      <select
        className={styles.advisorIntervalSelect}
        value={intervalMs}
        onChange={(event) =>
          onIntervalChange(Number(event.target.value) as AdvisorAutoInterval)
        }
        disabled={!enabled}
        aria-label="자동 재실행 주기"
      >
        {ADVISOR_AUTO_INTERVALS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
