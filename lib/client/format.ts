/**
 * Display formatters for the string-decimal values returned by the API.
 *
 * Every money/quantity field arrives as a string to preserve precision (large
 * quantities, fractional shares, won amounts beyond `Number.MAX_SAFE_INTEGER`).
 * These helpers format the *string* for display without ever round-tripping it
 * through a lossy JS number for the integer part. Only the already-bounded
 * fractional tail is handed to `Intl.NumberFormat`.
 */

/** Splits a decimal string into sign, integer digits, and fraction digits. */
function splitDecimal(value: string): {
  negative: boolean;
  intDigits: string;
  fracDigits: string;
} | null {
  const trimmed = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, sign, intPart, fracPart = ""] = match;
  return {
    negative: sign === "-",
    intDigits: intPart,
    fracDigits: fracPart,
  };
}

/** Groups an integer-digit string with thousands separators (no `Number`). */
function groupIntegerDigits(intDigits: string): string {
  const normalized = intDigits.replace(/^0+(?=\d)/, "");
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Rounds a fraction-digit string to `maxFractionDigits` (half-up), returning
 * the rounded fraction digits and whether the rounding carried into the
 * integer part.
 */
function roundFraction(
  fracDigits: string,
  maxFractionDigits: number,
): { fracDigits: string; carry: boolean } {
  if (fracDigits.length <= maxFractionDigits) {
    return { fracDigits, carry: false };
  }
  const kept = fracDigits.slice(0, maxFractionDigits);
  const nextDigit = fracDigits.charCodeAt(maxFractionDigits) - 48;
  if (nextDigit < 5) {
    return { fracDigits: kept, carry: false };
  }
  // Round half-up by incrementing the kept fraction as an integer string.
  if (maxFractionDigits === 0) {
    return { fracDigits: "", carry: true };
  }
  const digits = kept.split("");
  let i = digits.length - 1;
  for (; i >= 0; i -= 1) {
    if (digits[i] === "9") {
      digits[i] = "0";
    } else {
      digits[i] = String(Number(digits[i]) + 1);
      return { fracDigits: digits.join(""), carry: false };
    }
  }
  return { fracDigits: digits.join(""), carry: true };
}

/**
 * Adds two decimal strings exactly, using `BigInt` so no value ever passes
 * through a lossy JS float. Each operand is parsed into sign + integer digits +
 * fraction digits, both fractions are zero-padded to a common length so the
 * values become plain integers, the signed integers are summed as `BigInt`, the
 * decimal point is reinserted, and trailing fraction zeros are trimmed. Invalid
 * (or null/undefined) operands are treated as "0" so callers never get NaN.
 */
export function addDecimalStrings(
  a: string | null | undefined,
  b: string | null | undefined,
): string {
  const pa = a === null || a === undefined ? null : splitDecimal(a);
  const pb = b === null || b === undefined ? null : splitDecimal(b);
  const left = pa ?? { negative: false, intDigits: "0", fracDigits: "" };
  const right = pb ?? { negative: false, intDigits: "0", fracDigits: "" };

  const scale = Math.max(left.fracDigits.length, right.fracDigits.length);
  const toScaled = (parts: {
    negative: boolean;
    intDigits: string;
    fracDigits: string;
  }): bigint => {
    const digits = parts.intDigits + parts.fracDigits.padEnd(scale, "0");
    const magnitude = BigInt(digits);
    return parts.negative ? -magnitude : magnitude;
  };

  const sum = toScaled(left) + toScaled(right);
  return scaledBigIntToDecimal(sum, scale);
}

/** Renders a signed BigInt scaled by `scale` decimal places as a decimal string. */
function scaledBigIntToDecimal(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const absDigits = (negative ? -value : value).toString();

  let intPart: string;
  let fracPart: string;
  if (scale === 0) {
    intPart = absDigits;
    fracPart = "";
  } else {
    const padded = absDigits.padStart(scale + 1, "0");
    intPart = padded.slice(0, padded.length - scale);
    fracPart = padded.slice(padded.length - scale).replace(/0+$/, "");
  }
  intPart = intPart.replace(/^0+(?=\d)/, "");

  const body = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  const isZero = intPart === "0" && fracPart === "";
  return negative && !isZero ? `-${body}` : body;
}

/**
 * Multiplies two decimal strings precisely (no float). Used to convert a USD
 * amount to KRW via an exchange rate. Invalid/null operands are treated as "0".
 */
export function mulDecimalStrings(
  a: string | null | undefined,
  b: string | null | undefined,
): string {
  const zero = { negative: false, intDigits: "0", fracDigits: "" };
  const pa = (a === null || a === undefined ? null : splitDecimal(a)) ?? zero;
  const pb = (b === null || b === undefined ? null : splitDecimal(b)) ?? zero;
  const magA = BigInt(pa.intDigits + pa.fracDigits);
  const magB = BigInt(pb.intDigits + pb.fracDigits);
  const product = (pa.negative ? -magA : magA) * (pb.negative ? -magB : magB);
  return scaledBigIntToDecimal(
    product,
    pa.fracDigits.length + pb.fracDigits.length,
  );
}

/**
 * Floor-divides two non-negative decimal strings to a whole integer, precisely
 * (no float). Used to derive the maximum whole number of shares affordable for a
 * given buying power and price: `floor(amount / price)`. Both operands are scaled
 * to a common fraction length so they become plain integers, then divided as
 * `BigInt` (which truncates toward zero — equal to floor for non-negatives).
 * Returns `null` when either operand is invalid/negative or the divisor is zero,
 * so callers can distinguish "unknown" from a real "0".
 */
export function floorDivToInteger(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const pa = a === null || a === undefined ? null : splitDecimal(a);
  const pb = b === null || b === undefined ? null : splitDecimal(b);
  if (!pa || !pb || pa.negative || pb.negative) {
    return null;
  }
  const scale = Math.max(pa.fracDigits.length, pb.fracDigits.length);
  const numerator = BigInt(pa.intDigits + pa.fracDigits.padEnd(scale, "0"));
  const denominator = BigInt(pb.intDigits + pb.fracDigits.padEnd(scale, "0"));
  if (denominator === BigInt(0)) {
    return null;
  }
  return (numerator / denominator).toString();
}

/** Adds 1 to an integer-digit string (used when fraction rounding carries). */
function incrementIntegerDigits(intDigits: string): string {
  const digits = intDigits.split("");
  let i = digits.length - 1;
  for (; i >= 0; i -= 1) {
    if (digits[i] === "9") {
      digits[i] = "0";
    } else {
      digits[i] = String(Number(digits[i]) + 1);
      return digits.join("");
    }
  }
  return `1${digits.join("")}`;
}

export interface FormatDecimalOptions {
  /** Minimum fraction digits to always show (default 0). */
  minFractionDigits?: number;
  /** Maximum fraction digits before rounding (default 2). */
  maxFractionDigits?: number;
}

/**
 * Formats a decimal string with thousands grouping and bounded fraction
 * digits, preserving full integer precision. Returns "-" for null/invalid
 * input so callers never render a partial or NaN value.
 */
export function formatDecimal(
  value: string | null | undefined,
  options: FormatDecimalOptions = {},
): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const min = options.minFractionDigits ?? 0;
  const max = Math.max(options.maxFractionDigits ?? 2, min);

  const parts = splitDecimal(value);
  if (!parts) {
    return "-";
  }

  let { intDigits } = parts;
  const { negative, fracDigits } = parts;
  const rounded = roundFraction(fracDigits, max);
  let outFrac = rounded.fracDigits;
  if (rounded.carry) {
    intDigits = incrementIntegerDigits(intDigits);
  }

  // Pad/trim the fraction to satisfy min/max bounds.
  if (outFrac.length < min) {
    outFrac = outFrac.padEnd(min, "0");
  }
  outFrac = outFrac.replace(/0+$/, "");
  if (outFrac.length < min) {
    outFrac = outFrac.padEnd(min, "0");
  }

  const grouped = groupIntegerDigits(intDigits);
  const body = outFrac.length > 0 ? `${grouped}.${outFrac}` : grouped;
  // Avoid rendering "-0".
  const isZero = grouped === "0" && outFrac.replace(/0/g, "") === "";
  return negative && !isZero ? `-${body}` : body;
}

/**
 * Prefixes a formatted number with a currency symbol, moving a leading minus
 * sign in front of the symbol (e.g. "-50,000" -> "-₩50,000").
 */
function withCurrencySymbol(formatted: string, symbol: string): string {
  if (formatted === "-") {
    return formatted;
  }
  return formatted.startsWith("-")
    ? `-${symbol}${formatted.slice(1)}`
    : `${symbol}${formatted}`;
}

/** Formats a KRW amount string, e.g. "1234567" -> "₩1,234,567". */
export function formatKrw(value: string | null | undefined): string {
  return withCurrencySymbol(formatDecimal(value, { maxFractionDigits: 0 }), "₩");
}

/** Formats a USD amount string, e.g. "1234.5" -> "$1,234.50". Null -> "-". */
export function formatUsd(value: string | null | undefined): string {
  return withCurrencySymbol(
    formatDecimal(value, { minFractionDigits: 2, maxFractionDigits: 2 }),
    "$",
  );
}

/**
 * Formats a decimal *ratio* string as a percentage. The API expresses rates as
 * fractions (0.1516 = 15.16%), so the value is scaled by 100 before display.
 * The sign is always shown so gains/losses read at a glance.
 */
export function formatPercent(
  value: string | null | undefined,
  options: { maxFractionDigits?: number } = {},
): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const parts = splitDecimal(value);
  if (!parts) {
    return "-";
  }
  // Scale by 100 by shifting the decimal point two places, staying in strings.
  const max = options.maxFractionDigits ?? 2;
  const intDigits = parts.intDigits;
  const fracDigits = parts.fracDigits;
  const combined = intDigits + fracDigits;
  const pointPos = intDigits.length + 2; // shift right by 2
  let scaledInt: string;
  let scaledFrac: string;
  if (pointPos >= combined.length) {
    scaledInt = combined.padEnd(pointPos, "0");
    scaledFrac = "";
  } else {
    scaledInt = combined.slice(0, pointPos);
    scaledFrac = combined.slice(pointPos);
  }
  const scaled = `${parts.negative ? "-" : ""}${scaledInt}${
    scaledFrac ? `.${scaledFrac}` : ""
  }`;
  const formatted = formatDecimal(scaled, {
    minFractionDigits: 2,
    maxFractionDigits: max,
  });
  if (formatted === "-") {
    return "-";
  }
  const signed =
    !parts.negative && signOf(scaled) === "positive"
      ? `+${formatted}`
      : formatted;
  return `${signed}%`;
}

/**
 * Formats an ISO timestamp as a compact relative age from `nowMs`, e.g. "10s",
 * "5m", "3h", "2d", "3mo", "1y". `nowMs` is injected (not read from the clock)
 * so the function stays pure and deterministically testable — the caller passes
 * `Date.now()`. Returns "-" for a null/unparseable input and clamps future
 * timestamps to "0s". Units: s (<60s), m (<60min), h (<24h), d (<30d), mo
 * (<12 30-day months), else y. Minutes use "m" and months "mo" to avoid a clash.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  nowMs: number,
): string {
  if (iso === null || iso === undefined) {
    return "-";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "-";
  }
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo`;
  }
  return `${Math.floor(days / 365)}y`;
}

/** The sign of a decimal string: "positive" | "negative" | "zero". */
export function signOf(
  value: string | null | undefined,
): "positive" | "negative" | "zero" {
  if (value === null || value === undefined) {
    return "zero";
  }
  const parts = splitDecimal(value);
  if (!parts) {
    return "zero";
  }
  const hasNonZero = /[1-9]/.test(parts.intDigits + parts.fracDigits);
  if (!hasNonZero) {
    return "zero";
  }
  return parts.negative ? "negative" : "positive";
}
