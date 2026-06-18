import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/server/toss/rate-limiter";

/**
 * Deterministic clock + sleep. `sleep(ms)` advances the virtual clock so the
 * limiter's refill math is exercised without real timers.
 */
function fakeClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("serves the first acquire immediately (no wait)", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });

    const waited = await limiter.acquire("ACCOUNT");

    expect(waited).toBe(0);
  });

  it("makes the second ACCOUNT acquire wait ~1s (1 TPS)", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });

    const first = await limiter.acquire("ACCOUNT");
    const second = await limiter.acquire("ACCOUNT");

    expect(first).toBe(0);
    expect(second).toBe(1000);
    expect(clock.now()).toBe(1000);
  });

  it("does not wait once enough time has elapsed for a refill", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });

    await limiter.acquire("ACCOUNT");
    clock.advance(1000); // one full token regenerates at 1 TPS
    const second = await limiter.acquire("ACCOUNT");

    expect(second).toBe(0);
  });

  it("allows a burst up to the group capacity then throttles", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });

    // MARKET_INFO = 3 TPS => bucket starts with 3 tokens.
    const waits = [
      await limiter.acquire("MARKET_INFO"),
      await limiter.acquire("MARKET_INFO"),
      await limiter.acquire("MARKET_INFO"),
    ];
    expect(waits).toEqual([0, 0, 0]);

    const fourth = await limiter.acquire("MARKET_INFO");
    // 3 TPS => one token every ~333.33ms; ceil to 334ms.
    expect(fourth).toBe(334);
  });

  it("tracks groups independently", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });

    await limiter.acquire("ACCOUNT");
    // ASSET (5 TPS) is untouched, so its first acquire is immediate.
    const asset = await limiter.acquire("ASSET");

    expect(asset).toBe(0);
  });

  it("serves concurrent same-group acquires in order without double-spending", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });

    const [a, b, c] = await Promise.all([
      limiter.acquire("ACCOUNT"),
      limiter.acquire("ACCOUNT"),
      limiter.acquire("ACCOUNT"),
    ]);

    expect(a).toBe(0);
    expect(b).toBe(1000);
    expect(c).toBe(1000);
    expect(clock.now()).toBe(2000);
  });
});
