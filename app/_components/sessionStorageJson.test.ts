// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readSessionJson, writeSessionJson } from "./sessionStorageJson";

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === "number");

afterEach(() => {
  window.sessionStorage.clear();
});

describe("sessionStorageJson", () => {
  it("round-trips a value through sessionStorage", () => {
    writeSessionJson("k", [1, 2, 3]);
    expect(window.sessionStorage.getItem("k")).toBe("[1,2,3]");
    expect(readSessionJson("k", isNumberArray)).toEqual([1, 2, 3]);
  });

  it("returns null for a missing key", () => {
    expect(readSessionJson("absent", isNumberArray)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    window.sessionStorage.setItem("bad", "{not json");
    expect(readSessionJson("bad", isNumberArray)).toBeNull();
  });

  it("returns null when the value fails the type guard", () => {
    window.sessionStorage.setItem("wrong", JSON.stringify({ a: 1 }));
    expect(readSessionJson("wrong", isNumberArray)).toBeNull();
  });
});
