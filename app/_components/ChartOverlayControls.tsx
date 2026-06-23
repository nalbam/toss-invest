import styles from "./dashboard.module.css";

/**
 * Emoji toggle buttons shown right of "조언 받기" for the chart's AI-advice
 * overlays: the support/resistance price-level labels, the level lines
 * themselves, and the buy/sell advice vertical lines. Display-only — toggle
 * state is owned by the parent (the market panel).
 */
export function ChartOverlayControls({
  showLabels,
  showLines,
  showAdvice,
  onToggleLabels,
  onToggleLines,
  onToggleAdvice,
}: {
  showLabels: boolean;
  showLines: boolean;
  showAdvice: boolean;
  onToggleLabels: () => void;
  onToggleLines: () => void;
  onToggleAdvice: () => void;
}) {
  return (
    <div className={styles.chartOverlayControls}>
      <button
        type="button"
        className={`${styles.chartOverlayButton} ${
          showLabels ? styles.chartOverlayButtonActive : ""
        }`}
        aria-pressed={showLabels}
        aria-label="지지/저항 라벨 표시"
        title="지지/저항 라벨 표시"
        onClick={onToggleLabels}
      >
        <span aria-hidden="true">🏷️</span>
      </button>
      <button
        type="button"
        className={`${styles.chartOverlayButton} ${
          showLines ? styles.chartOverlayButtonActive : ""
        }`}
        aria-pressed={showLines}
        aria-label="지지/저항 선 표시"
        title="지지/저항 선 표시"
        onClick={onToggleLines}
      >
        <span aria-hidden="true">〰️</span>
      </button>
      <button
        type="button"
        className={`${styles.chartOverlayButton} ${
          showAdvice ? styles.chartOverlayButtonActive : ""
        }`}
        aria-pressed={showAdvice}
        aria-label="AI 조언 세로선 표시"
        title="AI 조언 세로선 표시"
        onClick={onToggleAdvice}
      >
        <span aria-hidden="true">📍</span>
      </button>
    </div>
  );
}
