import styles from "./dashboard.module.css";

/**
 * Renders a pre-formatted currency string, wrapping only the leading currency
 * symbol (`₩` or `$`, after any minus sign) in a span so it can be shown
 * slightly smaller and dimmer than the digits. Strings without a leading symbol
 * (e.g. the "-" placeholder) are rendered verbatim. The text content is
 * unchanged, so the rendered amount reads identically to the input string.
 */
export function Money({ value }: { value: string }) {
  const m = /^(-?)([₩$])(.*)$/.exec(value);
  if (!m) return <>{value}</>; // "-" 등은 그대로
  const [, sign, symbol, rest] = m;
  return (
    <>
      {sign}
      <span className={styles.currencySymbol}>{symbol}</span>
      {rest}
    </>
  );
}
