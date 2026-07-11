import { describe, expect, it } from "vitest";
import { isErrorEnvelope, isSuccessEnvelope } from "./envelope";

// Shared by advisor.ts / market-advisor.ts / favorites.ts / watchlist.ts /
// hooks.ts to decide whether a parsed response body is a success or error
// envelope. A false negative/positive here would silently break error
// handling across every one of those callers, so every edge case of the
// untrusted `unknown` input is covered directly.

describe("isErrorEnvelope", () => {
  it("rejects non-object and null bodies", () => {
    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope(undefined)).toBe(false);
    expect(isErrorEnvelope("error")).toBe(false);
    expect(isErrorEnvelope(42)).toBe(false);
    expect(isErrorEnvelope([])).toBe(false);
  });

  it("rejects an object with no error field", () => {
    expect(isErrorEnvelope({})).toBe(false);
    expect(isErrorEnvelope({ data: {} })).toBe(false);
  });

  it("rejects when error is not an object", () => {
    expect(isErrorEnvelope({ error: "boom" })).toBe(false);
    expect(isErrorEnvelope({ error: null })).toBe(false);
    expect(isErrorEnvelope({ error: 42 })).toBe(false);
  });

  it("rejects when code or message is missing or the wrong type", () => {
    expect(isErrorEnvelope({ error: {} })).toBe(false);
    expect(isErrorEnvelope({ error: { code: "x" } })).toBe(false);
    expect(isErrorEnvelope({ error: { message: "y" } })).toBe(false);
    expect(isErrorEnvelope({ error: { code: 1, message: "y" } })).toBe(false);
    expect(isErrorEnvelope({ error: { code: "x", message: 2 } })).toBe(false);
  });

  it("rejects when requestId is present but not a string", () => {
    expect(isErrorEnvelope({ error: { code: "x", message: "y", requestId: 1 } })).toBe(
      false,
    );
  });

  it("accepts a well-formed error envelope, with or without requestId", () => {
    expect(isErrorEnvelope({ error: { code: "x", message: "y" } })).toBe(true);
    expect(
      isErrorEnvelope({ error: { code: "x", message: "y", requestId: "r-1" } }),
    ).toBe(true);
  });

  it("ignores unrelated extra fields on the envelope and error object", () => {
    expect(
      isErrorEnvelope({
        error: { code: "x", message: "y", data: { detail: "z" } },
        extra: true,
      }),
    ).toBe(true);
  });
});

describe("isSuccessEnvelope", () => {
  it("rejects non-object and null bodies", () => {
    expect(isSuccessEnvelope(null)).toBe(false);
    expect(isSuccessEnvelope(undefined)).toBe(false);
    expect(isSuccessEnvelope("data")).toBe(false);
    expect(isSuccessEnvelope([])).toBe(false);
  });

  it("rejects an object with no data field", () => {
    expect(isSuccessEnvelope({})).toBe(false);
    expect(isSuccessEnvelope({ error: { code: "x", message: "y" } })).toBe(false);
  });

  it("accepts any object carrying a data field", () => {
    expect(isSuccessEnvelope({ data: { value: 1 } })).toBe(true);
    expect(isSuccessEnvelope({ data: [] })).toBe(true);
    expect(isSuccessEnvelope({ data: null })).toBe(true);
  });
});
