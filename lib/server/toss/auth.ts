import "server-only";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface TokenProviderConfig {
  apiBase: string;
  clientId: string;
  clientSecret: string;
  fetchFn: FetchFn;
  now: () => number;
  expirySkewSeconds?: number;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

interface ParsedToken {
  accessToken: string;
  expiresInSeconds: number;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const DEFAULT_EXPIRY_SKEW_SECONDS = 60;

/**
 * Single place that maps the raw token response into our internal shape. The
 * exact field name for expiry is validated against openapi.json in a later
 * iteration; isolating parsing here keeps that swap to one function.
 */
function parseTokenResponse(payload: unknown): ParsedToken {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Toss token response is not an object");
  }
  const record = payload as Record<string, unknown>;
  const accessToken = record.access_token;
  const expiresIn = record.expires_in;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Toss token response missing access_token");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    throw new Error("Toss token response missing numeric expires_in");
  }
  return { accessToken, expiresInSeconds: expiresIn };
}

export function createTokenProvider(config: TokenProviderConfig): TokenProvider {
  const skewSeconds = config.expirySkewSeconds ?? DEFAULT_EXPIRY_SKEW_SECONDS;
  let cached: CachedToken | null = null;
  let inFlight: Promise<string> | null = null;

  function isFresh(token: CachedToken): boolean {
    const skewMs = skewSeconds * 1000;
    return config.now() < token.expiresAtMs - skewMs;
  }

  async function issue(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    const response = await config.fetchFn(`${config.apiBase}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `Toss token request failed with status ${response.status}`,
      );
    }

    const parsed = parseTokenResponse(await response.json());
    cached = {
      accessToken: parsed.accessToken,
      expiresAtMs: config.now() + parsed.expiresInSeconds * 1000,
    };
    return parsed.accessToken;
  }

  return {
    async getAccessToken(): Promise<string> {
      if (cached && isFresh(cached)) {
        return cached.accessToken;
      }
      if (inFlight) {
        return inFlight;
      }
      inFlight = issue().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
