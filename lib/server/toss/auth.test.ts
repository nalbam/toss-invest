import { describe, expect, it, vi } from "vitest";
import { createTokenProvider } from "@/lib/server/toss/auth";

function tokenResponse(accessToken: string, expiresIn: number): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const config = {
  apiBase: "https://openapi.tossinvest.com",
  clientId: "id-123",
  clientSecret: "secret-456",
};

describe("createTokenProvider", () => {
  it("issues a token on the first call (fetch invoked once)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("tok-1", 3600));
    const now = 0;
    const provider = createTokenProvider({ ...config, fetchFn, now: () => now });

    const token = await provider.getAccessToken();

    expect(token).toBe("tok-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached token before expiry (no extra fetch)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("tok-1", 3600));
    let now = 0;
    const provider = createTokenProvider({ ...config, fetchFn, now: () => now });

    await provider.getAccessToken();
    now = 1000 * 1000; // 1000s later, still well before 3600s expiry
    const second = await provider.getAccessToken();

    expect(second).toBe("tok-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refreshes the token after expiry", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1", 3600))
      .mockResolvedValueOnce(tokenResponse("tok-2", 3600));
    let now = 0;
    const provider = createTokenProvider({ ...config, fetchFn, now: () => now });

    const first = await provider.getAccessToken();
    now = 3600 * 1000 + 1; // past expiry
    const second = await provider.getAccessToken();

    expect(first).toBe("tok-1");
    expect(second).toBe("tok-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("refreshes early when the token is within the expiry skew window", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1", 100))
      .mockResolvedValueOnce(tokenResponse("tok-2", 100));
    let now = 0;
    // 30s skew: a 100s token is considered stale at >= 70s.
    const provider = createTokenProvider({
      ...config,
      fetchFn,
      now: () => now,
      expirySkewSeconds: 30,
    });

    await provider.getAccessToken();
    now = 71 * 1000; // inside the skew window before the 100s hard expiry
    const second = await provider.getAccessToken();

    expect(second).toBe("tok-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("posts grant_type=client_credentials with client_id/secret as form-urlencoded", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("tok-1", 3600));
    const provider = createTokenProvider({ ...config, fetchFn, now: () => 0 });

    await provider.getAccessToken();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openapi.tossinvest.com/oauth2/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("id-123");
    expect(body.get("client_secret")).toBe("secret-456");
  });

  it("throws on a non-ok token response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401 }));
    const provider = createTokenProvider({ ...config, fetchFn, now: () => 0 });

    await expect(provider.getAccessToken()).rejects.toThrow();
  });

  it("de-duplicates concurrent issuance into a single fetch", async () => {
    const fetchFn = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(tokenResponse("tok-1", 3600)), 0);
        }),
    );
    const provider = createTokenProvider({ ...config, fetchFn, now: () => 0 });

    const [a, b] = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);

    expect(a).toBe("tok-1");
    expect(b).toBe("tok-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("re-issues on the next call after invalidate, even before expiry", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1", 3600))
      .mockResolvedValueOnce(tokenResponse("tok-2", 3600));
    const provider = createTokenProvider({ ...config, fetchFn, now: () => 0 });

    const first = await provider.getAccessToken();
    provider.invalidate();
    const second = await provider.getAccessToken(); // still within 3600s, cache cleared

    expect(first).toBe("tok-1");
    expect(second).toBe("tok-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
