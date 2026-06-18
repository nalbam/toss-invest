import "server-only";

/**
 * Endpoint groups that share a TPS budget. Several views can poll different
 * endpoints in the same group concurrently; the limiter keeps the combined
 * request rate per group within the documented limit.
 */
export type RateLimitGroup =
  | "ACCOUNT"
  | "ASSET"
  | "MARKET_DATA"
  | "MARKET_INFO";

/** Documented per-group sustained request rate (requests per second). */
export const GROUP_TPS: Record<RateLimitGroup, number> = {
  ACCOUNT: 1,
  ASSET: 5,
  MARKET_DATA: 10,
  MARKET_INFO: 3,
};

export interface RateLimiterConfig {
  /** Monotonic clock in milliseconds. Injected for deterministic tests. */
  now: () => number;
  /** Resolves after the given delay in ms. Injected for deterministic tests. */
  sleep: (ms: number) => Promise<void>;
  /** Optional override of the default per-group TPS. */
  tps?: Partial<Record<RateLimitGroup, number>>;
}

export interface RateLimiter {
  /**
   * Reserves one request slot for the group. Returns the milliseconds the
   * caller waited (0 when a token was immediately available). The returned
   * promise resolves only once the slot is available, so callers can simply
   * `await acquire(group)` before issuing a request.
   */
  acquire(group: RateLimitGroup): Promise<number>;
}

interface Bucket {
  /** Fractional tokens currently available. */
  tokens: number;
  /** Wall-clock (ms) of the last refill. */
  lastRefillMs: number;
  /** Capacity == TPS: a full bucket allows a one-second burst. */
  capacity: number;
  /** Tokens regenerated per millisecond. */
  refillPerMs: number;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const tps = { ...GROUP_TPS, ...config.tps };
  const buckets = new Map<RateLimitGroup, Bucket>();
  // Per-group queue tail: chains acquisitions so concurrent callers in the same
  // group are served in arrival order and never double-spend a token.
  const tails = new Map<RateLimitGroup, Promise<void>>();

  function bucketFor(group: RateLimitGroup): Bucket {
    let bucket = buckets.get(group);
    if (!bucket) {
      const rate = tps[group];
      bucket = {
        tokens: rate,
        lastRefillMs: config.now(),
        capacity: rate,
        refillPerMs: rate / 1000,
      };
      buckets.set(group, bucket);
    }
    return bucket;
  }

  function refill(bucket: Bucket): void {
    const nowMs = config.now();
    const elapsed = nowMs - bucket.lastRefillMs;
    if (elapsed > 0) {
      bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + elapsed * bucket.refillPerMs,
      );
      bucket.lastRefillMs = nowMs;
    }
  }

  async function acquireExclusive(group: RateLimitGroup): Promise<number> {
    const bucket = bucketFor(group);
    refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }

    // Wait for exactly one more token to regenerate.
    const deficit = 1 - bucket.tokens;
    const waitMs = Math.ceil(deficit / bucket.refillPerMs);
    await config.sleep(waitMs);
    refill(bucket);
    bucket.tokens -= 1;
    return waitMs;
  }

  return {
    acquire(group: RateLimitGroup): Promise<number> {
      const previous = tails.get(group) ?? Promise.resolve();
      const waited = previous.then(() => acquireExclusive(group));
      // Keep the chain alive regardless of how `waited` settles.
      tails.set(
        group,
        waited.then(
          () => undefined,
          () => undefined,
        ),
      );
      return waited;
    },
  };
}
