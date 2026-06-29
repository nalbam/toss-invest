import { describe, expect, it } from "vitest";
import { isEmailAllowed, parseAllowedDomains } from "@/lib/auth/allowlist";

describe("parseAllowedDomains", () => {
  it("defaults to nalbam.com when unset or blank", () => {
    expect(parseAllowedDomains(undefined)).toEqual(["nalbam.com"]);
    expect(parseAllowedDomains("")).toEqual(["nalbam.com"]);
    expect(parseAllowedDomains("   ")).toEqual(["nalbam.com"]);
  });

  it("splits a comma list and normalizes case/whitespace", () => {
    expect(parseAllowedDomains("Nalbam.com, Foo.COM")).toEqual([
      "nalbam.com",
      "foo.com",
    ]);
  });
});

describe("isEmailAllowed", () => {
  const domains = ["nalbam.com"];

  it("allows an exact-domain email", () => {
    expect(isEmailAllowed("me@nalbam.com", domains)).toBe(true);
  });

  it("normalizes case before matching", () => {
    expect(isEmailAllowed("ME@Nalbam.COM", domains)).toBe(true);
  });

  it("rejects another domain", () => {
    expect(isEmailAllowed("me@gmail.com", domains)).toBe(false);
  });

  it("rejects a subdomain (exact match only)", () => {
    expect(isEmailAllowed("me@sub.nalbam.com", domains)).toBe(false);
  });

  it("rejects null, undefined, blank, or missing @", () => {
    expect(isEmailAllowed(null, domains)).toBe(false);
    expect(isEmailAllowed(undefined, domains)).toBe(false);
    expect(isEmailAllowed("", domains)).toBe(false);
    expect(isEmailAllowed("nope", domains)).toBe(false);
    expect(isEmailAllowed("trailing@", domains)).toBe(false);
  });

  it("matches any domain in a multi-domain list", () => {
    expect(isEmailAllowed("me@foo.com", ["nalbam.com", "foo.com"])).toBe(true);
  });
});
