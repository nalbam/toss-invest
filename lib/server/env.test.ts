import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/server/env";

const validRaw = {
  TOSS_CLIENT_ID: "id-123",
  TOSS_CLIENT_SECRET: "secret-456",
  TOSS_ACCOUNT_SEQ: "789",
  TOSS_API_BASE: "https://openapi.tossinvest.com",
  DRY_RUN: "true",
  KILL_SWITCH: "false",
};

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv(validRaw);
    expect(env.TOSS_CLIENT_ID).toBe("id-123");
    expect(env.TOSS_CLIENT_SECRET).toBe("secret-456");
    expect(env.TOSS_ACCOUNT_SEQ).toBe("789");
    expect(env.TOSS_API_BASE).toBe("https://openapi.tossinvest.com");
    expect(env.DRY_RUN).toBe(true);
    expect(env.KILL_SWITCH).toBe(false);
  });

  it("throws when a required secret is missing", () => {
    const { TOSS_CLIENT_SECRET, ...missing } = validRaw;
    void TOSS_CLIENT_SECRET;
    expect(() => parseEnv(missing)).toThrow();
  });

  it("throws when a required secret is an empty string", () => {
    expect(() => parseEnv({ ...validRaw, TOSS_CLIENT_ID: "" })).toThrow();
  });

  it("defaults DRY_RUN to true (safe) when unset", () => {
    const { DRY_RUN, ...withoutDryRun } = validRaw;
    void DRY_RUN;
    const env = parseEnv(withoutDryRun);
    expect(env.DRY_RUN).toBe(true);
  });

  it("defaults KILL_SWITCH to false when unset", () => {
    const { KILL_SWITCH, ...withoutKill } = validRaw;
    void KILL_SWITCH;
    const env = parseEnv(withoutKill);
    expect(env.KILL_SWITCH).toBe(false);
  });

  it("defaults AUTO_TRADE_ENABLED to false (disarmed) when unset", () => {
    const env = parseEnv(validRaw);
    expect(env.AUTO_TRADE_ENABLED).toBe(false);
  });

  it('AUTO_TRADE_ENABLED is true only for the literal "true"', () => {
    expect(parseEnv({ ...validRaw, AUTO_TRADE_ENABLED: "true" }).AUTO_TRADE_ENABLED).toBe(
      true,
    );
    expect(
      parseEnv({ ...validRaw, AUTO_TRADE_ENABLED: "false" }).AUTO_TRADE_ENABLED,
    ).toBe(false);
  });

  it("defaults TOSS_API_BASE when unset", () => {
    const { TOSS_API_BASE, ...withoutBase } = validRaw;
    void TOSS_API_BASE;
    const env = parseEnv(withoutBase);
    expect(env.TOSS_API_BASE).toBe("https://openapi.tossinvest.com");
  });

  it("rejects a non-url TOSS_API_BASE", () => {
    expect(() => parseEnv({ ...validRaw, TOSS_API_BASE: "not-a-url" })).toThrow();
  });
});
