import "server-only";
import { z } from "zod";
import type { FetchFn, TokenProvider } from "@/lib/server/toss/auth";
import type {
  RateLimiter,
  RateLimitGroup,
} from "@/lib/server/toss/rate-limiter";
import { errorResponseSchema } from "@/lib/server/toss/schemas";

/** Success envelope shape. `result` is validated separately per endpoint. */
const envelopeSchema = z.object({ result: z.unknown() });

/** Maximum number of automatic retries on a 429 before giving up. */
export const MAX_RETRIES = 3;
/** Base backoff delays (seconds) applied per retry attempt: 1 -> 2 -> 4. */
const BACKOFF_SECONDS = [1, 2, 4] as const;
/** Jitter window (ms) added on top of each backoff delay. */
const JITTER_MAX_MS = 1000;

/**
 * Typed error for non-2xx Toss API responses. Carries the parsed error
 * envelope fields so callers can branch on `code`/`status` without re-reading
 * the body.
 */
export class TossApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly data: Record<string, unknown> | null | undefined;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    data?: Record<string, unknown> | null;
  }) {
    super(args.message);
    this.name = "TossApiError";
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
    this.data = args.data;
  }
}

export interface RateLimitSnapshot {
  limit?: number;
  remaining?: number;
  reset?: number;
}

export interface TossClientConfig {
  tokenProvider: TokenProvider;
  fetchFn: FetchFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  rateLimiter: RateLimiter;
  baseUrl: string;
  /** Deterministic jitter source in tests; defaults to Math.random. */
  random?: () => number;
}

export interface RequestOptions {
  group: RateLimitGroup;
  /** Query parameters appended to the URL (undefined values skipped). */
  query?: Record<string, string | undefined>;
  /** When set, sends the `X-Tossinvest-Account` header. */
  accountSeq?: number | string;
}

export interface TossClient {
  /**
   * Issues an authenticated GET, unwraps the `{ result }` envelope, validates
   * `result` against `resultSchema`, and returns it. Throws `TossApiError` for
   * non-2xx responses (after exhausting 429 retries).
   */
  get<T extends z.ZodTypeAny>(
    path: string,
    resultSchema: T,
    options: RequestOptions,
  ): Promise<z.infer<T>>;
  /** Last observed `X-RateLimit-*` values per group (when the API sends them). */
  rateLimitSnapshot(group: RateLimitGroup): RateLimitSnapshot | undefined;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

function readRequestId(response: Response): string | undefined {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("cf-ray") ??
    undefined
  );
}

function readRateLimit(response: Response): RateLimitSnapshot | undefined {
  const limit = response.headers.get("x-ratelimit-limit");
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (limit === null && remaining === null && reset === null) {
    return undefined;
  }
  const toNumber = (value: string | null): number | undefined => {
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    limit: toNumber(limit),
    remaining: toNumber(remaining),
    reset: toNumber(reset),
  };
}

/**
 * Resolves the wait (ms) before a 429 retry. Honors `Retry-After` (seconds)
 * when present, otherwise uses exponential backoff. Jitter is always added.
 */
function retryDelayMs(
  response: Response,
  attempt: number,
  random: () => number,
): number {
  const retryAfter = response.headers.get("retry-after");
  let baseMs: number;
  if (retryAfter !== null && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    baseMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
  } else {
    const backoff = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
    baseMs = backoff * 1000;
  }
  return baseMs + Math.floor(random() * JITTER_MAX_MS);
}

export function createTossClient(config: TossClientConfig): TossClient {
  const random = config.random ?? Math.random;
  const snapshots = new Map<RateLimitGroup, RateLimitSnapshot>();

  async function execute(
    path: string,
    options: RequestOptions,
  ): Promise<Response> {
    const url = buildUrl(config.baseUrl, path, options.query);

    for (let attempt = 0; ; attempt += 1) {
      await config.rateLimiter.acquire(options.group);

      const token = await config.tokenProvider.getAccessToken();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      };
      if (options.accountSeq !== undefined) {
        headers["x-tossinvest-account"] = String(options.accountSeq);
      }

      const response = await config.fetchFn(url, { method: "GET", headers });

      const snapshot = readRateLimit(response);
      if (snapshot) {
        snapshots.set(options.group, snapshot);
      }

      if (response.status !== 429) {
        return response;
      }

      if (attempt >= MAX_RETRIES) {
        return response;
      }

      const delay = retryDelayMs(response, attempt, random);
      await config.sleep(delay);
    }
  }

  async function toApiError(response: Response): Promise<TossApiError> {
    const requestId = readRequestId(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const parsed = errorResponseSchema.safeParse(body);
    if (parsed.success) {
      const { error } = parsed.data;
      return new TossApiError({
        status: response.status,
        code: error.code,
        message: error.message,
        requestId: error.requestId ?? requestId,
        data: error.data,
      });
    }
    return new TossApiError({
      status: response.status,
      code: "unknown-error",
      message: `Toss API request failed with status ${response.status}`,
      requestId,
    });
  }

  return {
    async get(path, resultSchema, options) {
      const response = await execute(path, options);

      if (!response.ok) {
        throw await toApiError(response);
      }

      const envelope = envelopeSchema.parse(await response.json());
      return resultSchema.parse(envelope.result);
    },
    rateLimitSnapshot(group) {
      return snapshots.get(group);
    },
  };
}
