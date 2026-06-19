import { describe, expect, it } from "vitest";
import {
  addDecimalStrings,
  floorDivToInteger,
  formatDecimal,
  formatKrw,
  formatPercent,
  formatUsd,
  mulDecimalStrings,
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

describe("addDecimalStrings", () => {
  it("adds large integer KRW amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    // 9_007_199_254_740_993 is MAX_SAFE_INTEGER + 2; a float add would lose it.
    expect(addDecimalStrings("9007199254740993", "1")).toBe("9007199254740994");
    expect(addDecimalStrings("11516000", "5000000")).toBe("16516000");
  });

  it("adds fractional USD amounts and trims trailing zeros", () => {
    expect(addDecimalStrings("8060.50", "1200.25")).toBe("9260.75");
    expect(addDecimalStrings("0.1", "0.2")).toBe("0.3");
    expect(addDecimalStrings("1234.5", "0.50")).toBe("1235");
  });

  it("handles negative operands and the resulting sign", () => {
    expect(addDecimalStrings("100", "-30")).toBe("70");
    expect(addDecimalStrings("30", "-100")).toBe("-70");
    expect(addDecimalStrings("-1.5", "-2.25")).toBe("-3.75");
  });

  it("aligns operands with different fraction lengths", () => {
    expect(addDecimalStrings("1.5", "2.005")).toBe("3.505");
    expect(addDecimalStrings("0.001", "0.0009")).toBe("0.0019");
  });

  it("returns 0 for zeros and avoids -0", () => {
    expect(addDecimalStrings("0", "0")).toBe("0");
    expect(addDecimalStrings("-0.00", "0")).toBe("0");
    expect(addDecimalStrings("5", "-5")).toBe("0");
  });

  it("treats null/undefined/invalid operands as 0", () => {
    expect(addDecimalStrings(null, "100")).toBe("100");
    expect(addDecimalStrings("100", undefined)).toBe("100");
    expect(addDecimalStrings("abc", "100")).toBe("100");
    expect(addDecimalStrings("abc", "xyz")).toBe("0");
  });
});

describe("mulDecimalStrings", () => {
  it("multiplies precisely (USD * FX rate -> KRW)", () => {
    expect(mulDecimalStrings("1940.49", "1500")).toBe("2910735");
    expect(mulDecimalStrings("279.29", "1500")).toBe("418935");
    expect(mulDecimalStrings("8060.50", "1500")).toBe("12090750");
  });

  it("preserves fractions without float error", () => {
    expect(mulDecimalStrings("0.1", "0.2")).toBe("0.02");
    expect(mulDecimalStrings("1.5", "2")).toBe("3");
    expect(mulDecimalStrings("100", "0")).toBe("0");
  });

  it("handles negatives and null/invalid (treated as 0)", () => {
    expect(mulDecimalStrings("-2", "3")).toBe("-6");
    expect(mulDecimalStrings("-2", "-3")).toBe("6");
    expect(mulDecimalStrings(null, "1500")).toBe("0");
    expect(mulDecimalStrings("abc", "1500")).toBe("0");
  });
});

describe("floorDivToInteger", () => {
  it("floors the quotient to a whole number of shares", () => {
    // Max buyable = floor(buying power / price).
    expect(floorDivToInteger("1000000", "71000")).toBe("14");
    expect(floorDivToInteger("710000", "71000")).toBe("10");
    expect(floorDivToInteger("5000", "185.70")).toBe("26");
  });

  it("aligns operands with different fraction lengths", () => {
    expect(floorDivToInteger("1000.50", "100.25")).toBe("9");
    expect(floorDivToInteger("100", "33.33")).toBe("3");
  });

  it("returns '0' when the amount is below one share or zero", () => {
    expect(floorDivToInteger("100", "71000")).toBe("0");
    expect(floorDivToInteger("0", "71000")).toBe("0");
  });

  it("preserves precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(floorDivToInteger("9007199254740993", "1")).toBe(
      "9007199254740993",
    );
  });

  it("returns null for a zero, negative, or invalid divisor", () => {
    expect(floorDivToInteger("1000", "0")).toBeNull();
    expect(floorDivToInteger("1000", "-5")).toBeNull();
    expect(floorDivToInteger("1000", "abc")).toBeNull();
  });

  it("returns null for a negative, null, or invalid amount", () => {
    expect(floorDivToInteger("-1000", "5")).toBeNull();
    expect(floorDivToInteger(null, "5")).toBeNull();
    expect(floorDivToInteger(undefined, "5")).toBeNull();
    expect(floorDivToInteger("abc", "5")).toBeNull();
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
