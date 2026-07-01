import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

import { withAuth } from "./with-auth";

describe("withAuth", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("returns 401 and skips the handler when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(new Request("http://test/api/x"), undefined);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("calls the handler and passes the route context through when authenticated", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withAuth(handler);
    const req = new Request("http://test/api/x");
    const ctx = { params: Promise.resolve({ orderId: "1" }) };

    const res = await wrapped(req, ctx);

    expect(handler).toHaveBeenCalledWith(req, ctx);
    expect(await res.text()).toBe("ok");
  });

  it("validates the session against the request headers", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    const wrapped = withAuth(async () => new Response("ok"));
    const req = new Request("http://test/api/x", {
      headers: { cookie: "session=abc" },
    });

    await wrapped(req, undefined);

    expect(getSession).toHaveBeenCalledWith({ headers: req.headers });
  });
});
