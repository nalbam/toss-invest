import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runAdvisorJobsOnce } = vi.hoisted(() => ({
  runAdvisorJobsOnce: vi.fn(),
}));

vi.mock("@/lib/server/market-advisor/jobs", () => ({ runAdvisorJobsOnce }));
vi.mock("@/lib/server/toss/container", () => ({ getServerTossClient: () => ({}) }));
vi.mock("@/lib/server/llm/container", () => ({ getServerLlmProvider: () => ({}) }));
vi.mock("@/lib/server/news/container", () => ({ getServerNewsSearch: () => null }));

import { POST } from "./route";

function postReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/advisor-jobs/run", { method: "POST", headers });
}

// This route is one of the two documented exceptions to `withAuth` (see
// with-auth-coverage.test.ts) — it is a machine-to-machine trigger
// authenticated by ADVISOR_JOBS_TOKEN (Bearer) instead of a user session, so
// its own auth branch needs direct coverage.
describe("POST /api/advisor-jobs/run", () => {
  const originalToken = process.env.ADVISOR_JOBS_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ADVISOR_JOBS_TOKEN;
    } else {
      process.env.ADVISOR_JOBS_TOKEN = originalToken;
    }
  });

  it("returns 401 and never runs jobs when ADVISOR_JOBS_TOKEN is not configured (fail-closed)", async () => {
    delete process.env.ADVISOR_JOBS_TOKEN;

    const res = await POST(postReq({ authorization: "Bearer anything" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("advisor-jobs-disabled");
    expect(runAdvisorJobsOnce).not.toHaveBeenCalled();
  });

  it("returns 401 and never runs jobs when the bearer token is missing or wrong", async () => {
    process.env.ADVISOR_JOBS_TOKEN = "secret-token";

    const missing = await POST(postReq());
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("unauthorized");

    const wrong = await POST(postReq({ authorization: "Bearer not-the-secret" }));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe("unauthorized");

    expect(runAdvisorJobsOnce).not.toHaveBeenCalled();
  });

  it("runs the jobs pass and returns its summary when the bearer token matches", async () => {
    process.env.ADVISOR_JOBS_TOKEN = "secret-token";
    runAdvisorJobsOnce.mockResolvedValue({ processed: 2, analyzed: 1, results: [] });

    const res = await POST(postReq({ authorization: "Bearer secret-token" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      data: { processed: 2, analyzed: 1, results: [] },
    });
    expect(runAdvisorJobsOnce).toHaveBeenCalledTimes(1);
  });
});
