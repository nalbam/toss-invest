import { describe, expect, it } from "vitest";
import { isKrwSymbol } from "./symbol";

describe("isKrwSymbol", () => {
  it("treats all-digit KRX codes as KRW", () => {
    expect(isKrwSymbol("005930")).toBe(true);
  });

  it("treats newer alphanumeric KRX codes as KRW", () => {
    // Regression: digit-led 6-char codes with an embedded letter (e.g. ETFs
    // like SOL AI반도체TOP2플러스 `0167A0`) are KRW, not USD. A `/^\d{6}$/`
    // predicate misclassified these as USD and inflated the notional by the FX
    // rate, tripping the MAX_ORDER_AMOUNT gate.
    expect(isKrwSymbol("0167A0")).toBe(true);
  });

  it("treats US tickers as non-KRW", () => {
    expect(isKrwSymbol("AAPL")).toBe(false);
    expect(isKrwSymbol("SOXL")).toBe(false);
  });

  it("rejects malformed or wrong-length codes", () => {
    expect(isKrwSymbol("")).toBe(false);
    expect(isKrwSymbol("00593")).toBe(false); // 5 chars
    expect(isKrwSymbol("0059300")).toBe(false); // 7 chars
    expect(isKrwSymbol("A05930")).toBe(false); // letter-led (US-like)
    expect(isKrwSymbol("0167a0")).toBe(false); // lowercase not a KRX code
  });
});
