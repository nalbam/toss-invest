import { describe, expect, it } from "vitest";
import {
  formatDecimal,
  formatKrw,
  formatPercent,
  formatUsd,
  signOf,
} from "@/lib/client/format";

describe("formatDecimal", () => {
  it("groups thousands and trims trailing zeros", () => {
    expect(formatDecimal("1234567")).toBe("1,234,567");
    expect(formatDecimal("1234.50")).toBe("1,234.5");
  });

  it("rounds half-up to the max fraction digits", () => {
    expect(formatDecimal("1.005", { maxFractionDigits: 2 })).toBe("1.01");
    expect(formatDecimal("1.004", { maxFractionDigits: 2 })).toBe("1");
  });

  it("carries rounding into the integer part", () => {
    expect(formatDecimal("9.999", { maxFractionDigits: 2 })).toBe("10");
    expect(formatDecimal("99.9", { maxFractionDigits: 0 })).toBe("100");
  });

  it("preserves integer precision beyond Number.MAX_SAFE_INTEGER", () => {
    // 9_007_199_254_740_993 is MAX_SAFE_INTEGER + 2; a Number round-trip loses it.
    expect(formatDecimal("9007199254740993")).toBe("9,007,199,254,740,993");
  });

  it("handles negatives and avoids -0", () => {
    expect(formatDecimal("-1234.5")).toBe("-1,234.5");
    expect(formatDecimal("-0.00", { maxFractionDigits: 2 })).toBe("0");
  });

  it("returns '-' for null, undefined, and invalid input", () => {
    expect(formatDecimal(null)).toBe("-");
    expect(formatDecimal(undefined)).toBe("-");
    expect(formatDecimal("abc")).toBe("-");
  });
});

describe("formatKrw", () => {
  it("prefixes ₩ and shows no fraction digits", () => {
    expect(formatKrw("1234567")).toBe("₩1,234,567");
    expect(formatKrw("1234.9")).toBe("₩1,235");
  });

  it("moves the minus sign in front of the symbol", () => {
    expect(formatKrw("-50000")).toBe("-₩50,000");
  });

  it("returns '-' for null", () => {
    expect(formatKrw(null)).toBe("-");
  });
});

describe("formatUsd", () => {
  it("prefixes $ and always shows two fraction digits", () => {
    expect(formatUsd("1234.5")).toBe("$1,234.50");
    expect(formatUsd("1000")).toBe("$1,000.00");
  });

  it("returns '-' for a null usd amount", () => {
    expect(formatUsd(null)).toBe("-");
  });
});

describe("formatPercent", () => {
  it("scales a fractional ratio by 100", () => {
    expect(formatPercent("0.1516")).toBe("+15.16%");
    expect(formatPercent("0.05")).toBe("+5.00%");
  });

  it("shows a minus sign for negative ratios", () => {
    expect(formatPercent("-0.0825")).toBe("-8.25%");
  });

  it("does not sign zero", () => {
    expect(formatPercent("0")).toBe("0.00%");
  });

  it("returns '-' for null/invalid", () => {
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent("xyz")).toBe("-");
  });
});

describe("signOf", () => {
  it("classifies positive, negative, and zero", () => {
    expect(signOf("0.01")).toBe("positive");
    expect(signOf("-0.01")).toBe("negative");
    expect(signOf("0")).toBe("zero");
    expect(signOf("0.00")).toBe("zero");
    expect(signOf("-0.00")).toBe("zero");
  });

  it("treats null/invalid as zero", () => {
    expect(signOf(null)).toBe("zero");
    expect(signOf("abc")).toBe("zero");
  });
});
