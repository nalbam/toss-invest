import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TokenProvider } from "@/lib/server/toss/auth";
import {
  createTossClient,
  MAX_RETRIES,
  TossApiError,
} from "@/lib/server/toss/client";
import type { RateLimitGroup } from "@/lib/server/toss/rate-limiter";

const BASE_URL = "https://openapi.tossinvest.com";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const tokenProvider: TokenProvider = {
  getAccessToken: async () => "tok-abc",
  invalidate: () => {},
};

const resultSchema = z.object({ value: z.string() });

interface Harness {
  fetchFn: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
  acquire: ReturnType<typeof vi.fn>;
  client: ReturnType<typeof createTossClient>;
}

function harness(
  responses: Response[],
  opts: { random?: () => number; tokenProvider?: TokenProvider } = {},
): Harness {
  const queue = [...responses];
  const fetchFn = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
  const sleep = vi.fn(async () => {});
  const acquire = vi.fn(async (group: RateLimitGroup) => {
    void group;
    return 0;
  });
  const client = createTossClient({
    tokenProvider: opts.tokenProvider ?? tokenProvider,
    fetchFn,
    now: () => 0,
    sleep,
    rateLimiter: { acquire },
    baseUrl: BASE_URL,
    random: opts.random ?? (() => 0),
  });
  return { fetchFn, sleep, acquire, client };
}

describe("createTossClient envelope handling", () => {
  it("unwraps result on a 2xx response", async () => {
    const { client } = harness([jsonResponse({ result: { value: "ok" } })]);

    const result = await client.get("/api/v1/thing", resultSchema, {
      group: "ACCOUNT",
    });

    expect(result).toEqual({ value: "ok" });
  });

  it("acquires a rate-limit slot for the group before fetching", async () => {
    const { acquire, client } = harness([
      jsonResponse({ result: { value: "ok" } }),
    ]);

    await client.get("/api/v1/thing", resultSchema, { group: "ASSET" });

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith("ASSET");
  });
});

describe("createTossClient error handling", () => {
  it("throws a typed TossApiError parsed from the error envelope", async () => {
    const { client } = harness([
      jsonResponse(
        {
          error: {
            requestId: "req-1",
            code: "account-not-found",
            message: "계좌를 찾을 수 없습니다",
            data: null,
          },
        },
        { status: 404 },
      ),
    ]);

    const error = await client
      .get("/api/v1/thing", resultSchema, { group: "ACCOUNT" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TossApiError);
    const apiError = error as TossApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.code).toBe("account-not-found");
    expect(apiError.requestId).toBe("req-1");
    expect(apiError.message).toBe("계좌를 찾을 수 없습니다");
  });

  it("preserves code/message from an error envelope missing requestId, falling back to the header", async () => {
    const { client } = harness([
      jsonResponse(
        { error: { code: "account-not-found", message: "no requestId in body" } },
        { status: 404, headers: { "x-request-id": "header-req-id" } },
      ),
    ]);

    const error = (await client
      .get("/api/v1/thing", resultSchema, { group: "ACCOUNT" })
      .catch((e: unknown) => e)) as TossApiError;

    expect(error).toBeInstanceOf(TossApiError);
    expect(error.code).toBe("account-not-found");
    expect(error.message).toBe("no requestId in body");
    expect(error.requestId).toBe("header-req-id");
  });

  it("falls back to a generic error when the body is not an error envelope", async () => {
    const { client } = harness([
      new Response("upstream boom", {
        status: 500,
        headers: { "x-request-id": "req-9" },
      }),
    ]);

    const error = (await client
      .get("/api/v1/thing", resultSchema, { group: "ACCOUNT" })
      .catch((e: unknown) => e)) as TossApiError;

    expect(error).toBeInstanceOf(TossApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("unknown-error");
    expect(error.requestId).toBe("req-9");
  });
});

describe("createTossClient 429 retry", () => {
  it("honors Retry-After then retries once and succeeds", async () => {
    const { client, sleep, fetchFn } = harness([
      jsonResponse(
        { error: { requestId: "r", code: "rate-limited", message: "slow down" } },
        { status: 429, headers: { "retry-after": "2" } },
      ),
      jsonResponse({ result: { value: "ok" } }),
    ]);

    const result = await client.get("/api/v1/thing", resultSchema, {
      group: "MARKET_DATA",
    });

    expect(result).toEqual({ value: "ok" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Retry-After (2s) + deterministic jitter (random()=0 => 0ms).
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("uses exponential backoff with jitter when Retry-After is absent", async () => {
    const { client, sleep } = harness(
      [
        jsonResponse(
          { error: { requestId: "r", code: "rate-limited", message: "slow" } },
          { status: 429 },
        ),
        jsonResponse(
          { error: { requestId: "r", code: "rate-limited", message: "slow" } },
          { status: 429 },
        ),
        jsonResponse({ result: { value: "ok" } }),
      ],
      { random: () => 0.5 }, // jitter = floor(0.5 * 1000) = 500ms
    );

    const result = await client.get("/api/v1/thing", resultSchema, {
      group: "MARKET_DATA",
    });

    expect(result).toEqual({ value: "ok" });
    expect(sleep).toHaveBeenNthCalledWith(1, 1000 + 500); // attempt 0 => 1s base
    expect(sleep).toHaveBeenNthCalledWith(2, 2000 + 500); // attempt 1 => 2s base
  });

  it("gives up after MAX_RETRIES and throws the last error", async () => {
    const tooMan_429 = Array.from({ length: MAX_RETRIES + 1 }, () =>
      jsonResponse(
        { error: { requestId: "r", code: "rate-limited", message: "slow" } },
        { status: 429 },
      ),
    );
    const { client, fetchFn } = harness(tooMan_429);

    const error = (await client
      .get("/api/v1/thing", resultSchema, { group: "MARKET_DATA" })
      .catch((e: unknown) => e)) as TossApiError;

    expect(error).toBeInstanceOf(TossApiError);
    expect(error.status).toBe(429);
    // initial attempt + MAX_RETRIES retries
    expect(fetchFn).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });
});

describe("createTossClient 401 token recovery", () => {
  it("re-issues the token once and retries on a 401, then succeeds", async () => {
    const invalidate = vi.fn();
    let issued = 0;
    const tp: TokenProvider = {
      getAccessToken: async () => `tok-${issued++}`,
      invalidate,
    };
    const { client, fetchFn } = harness(
      [
        jsonResponse(
          { error: { requestId: "r", code: "invalid-token", message: "bad token" } },
          { status: 401 },
        ),
        jsonResponse({ result: { value: "ok" } }),
      ],
      { tokenProvider: tp },
    );

    const result = await client.get("/api/v1/thing", resultSchema, {
      group: "MARKET_DATA",
    });

    expect(result).toEqual({ value: "ok" });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("recovers from a 401 only once, then surfaces the error", async () => {
    const invalidate = vi.fn();
    const tp: TokenProvider = {
      getAccessToken: async () => "tok",
      invalidate,
    };
    const { client, fetchFn } = harness(
      [
        jsonResponse(
          { error: { requestId: "r", code: "invalid-token", message: "bad" } },
          { status: 401 },
        ),
        jsonResponse(
          { error: { requestId: "r", code: "invalid-token", message: "bad" } },
          { status: 401 },
        ),
      ],
      { tokenProvider: tp },
    );

    const error = (await client
      .get("/api/v1/thing", resultSchema, { group: "MARKET_DATA" })
      .catch((e: unknown) => e)) as TossApiError;

    expect(error).toBeInstanceOf(TossApiError);
    expect(error.status).toBe(401);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2); // initial + one re-auth retry
  });

  it("does not spend the 429 backoff budget on the 401 retry", async () => {
    // A 401 followed by MAX_RETRIES 429s must still exhaust all 429 retries:
    // the 401 retry rewinds `attempt`, so it never counts against the backoff.
    const { client, fetchFn } = harness([
      jsonResponse(
        { error: { requestId: "r", code: "invalid-token", message: "bad" } },
        { status: 401 },
      ),
      ...Array.from({ length: MAX_RETRIES }, () =>
        jsonResponse(
          { error: { requestId: "r", code: "rate-limited", message: "slow" } },
          { status: 429 },
        ),
      ),
      jsonResponse({ result: { value: "ok" } }),
    ]);

    const result = await client.get("/api/v1/thing", resultSchema, {
      group: "MARKET_DATA",
    });

    expect(result).toEqual({ value: "ok" });
    // initial 401 + 1 re-auth + MAX_RETRIES 429 attempts + final success
    expect(fetchFn).toHaveBeenCalledTimes(MAX_RETRIES + 2);
  });
});

describe("createTossClient POST 401 token recovery", () => {
  it("re-issues the token once and retries a POST on a 401, then succeeds", async () => {
    const invalidate = vi.fn();
    let issued = 0;
    const tp: TokenProvider = {
      getAccessToken: async () => `tok-${issued++}`,
      invalidate,
    };
    const { client, fetchFn } = harness(
      [
        jsonResponse(
          { error: { requestId: "r", code: "invalid-token", message: "bad token" } },
          { status: 401 },
        ),
        jsonResponse({ result: { value: "ok" } }),
      ],
      { tokenProvider: tp },
    );

    const result = await client.post("/api/v1/orders", resultSchema, {
      group: "ORDER",
      body: { clientOrderId: "abc-123" },
    });

    expect(result).toEqual({ value: "ok" });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // The identical body (same clientOrderId) is replayed, not regenerated.
    const bodies = fetchFn.mock.calls.map((call) => (call[1] as RequestInit).body);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("recovers a POST from a 401 only once, then surfaces the error", async () => {
    const invalidate = vi.fn();
    const tp: TokenProvider = { getAccessToken: async () => "tok", invalidate };
    const { client, fetchFn } = harness(
      [
        jsonResponse(
          { error: { requestId: "r", code: "invalid-token", message: "bad" } },
          { status: 401 },
        ),
        jsonResponse(
          { error: { requestId: "r", code: "invalid-token", message: "bad" } },
          { status: 401 },
        ),
      ],
      { tokenProvider: tp },
    );

    const error = (await client
      .post("/api/v1/orders", resultSchema, { group: "ORDER", body: {} })
      .catch((e: unknown) => e)) as TossApiError;

    expect(error).toBeInstanceOf(TossApiError);
    expect(error.status).toBe(401);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("still does not retry a POST on a 429 (unchanged)", async () => {
    const { client, fetchFn } = harness([
      jsonResponse(
        { error: { requestId: "r", code: "rate-limited", message: "slow" } },
        { status: 429 },
      ),
    ]);

    const error = (await client
      .post("/api/v1/orders", resultSchema, { group: "ORDER", body: {} })
      .catch((e: unknown) => e)) as TossApiError;

    expect(error).toBeInstanceOf(TossApiError);
    expect(error.status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("createTossClient rate-limit headers", () => {
  it("captures X-RateLimit-* values from the response", async () => {
    const { client } = harness([
      jsonResponse(
        { result: { value: "ok" } },
        {
          headers: {
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "3",
            "x-ratelimit-reset": "1700000000",
          },
        },
      ),
    ]);

    await client.get("/api/v1/thing", resultSchema, { group: "MARKET_DATA" });

    expect(client.rateLimitSnapshot("MARKET_DATA")).toEqual({
      limit: 10,
      remaining: 3,
      reset: 1700000000,
    });
  });
});
