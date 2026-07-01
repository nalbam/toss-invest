import { beforeEach, describe, expect, it, vi } from "vitest";

// The KV store itself is covered by settings/store.test.ts; here we mock it so
// the route's input validation + error mapping are tested in isolation.
const { applySettings, getAllSettings, SettingsLimitError } = vi.hoisted(() => {
  class SettingsLimitError extends Error {}
  return {
    applySettings: vi.fn(),
    getAllSettings: vi.fn(() => ({}) as Record<string, string>),
    SettingsLimitError,
  };
});

vi.mock("@/lib/server/settings/store", () => ({
  applySettings,
  getAllSettings,
  SettingsLimitError,
}));

// Plain function (not vi.fn) so the per-test `vi.clearAllMocks()` never wipes it
// and the route sees an authenticated session under `withAuth`.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "test" } }) } },
}));

import { GET, PUT } from "@/app/api/settings/route";

function getRequest() {
  return new Request("http://test/api/settings");
}

function putRequest(body: unknown, raw?: string) {
  return new Request("http://test/api/settings", {
    method: "PUT",
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settings route — GET", () => {
  it("returns the stored settings in an envelope", async () => {
    getAllSettings.mockReturnValue({ "toss-invest:theme": "dark" });
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { settings: Record<string, string> } };
    expect(body.data.settings).toEqual({ "toss-invest:theme": "dark" });
  });
});

describe("settings route — PUT", () => {
  it("applies a valid upsert and returns 200", async () => {
    const change = { upserts: [{ key: "toss-invest:theme", value: "dark" }] };
    const res = await PUT(putRequest(change));
    expect(res.status).toBe(200);
    expect(applySettings).toHaveBeenCalledWith(change);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const res = await PUT(putRequest(null, "{not json"));
    expect(res.status).toBe(400);
    expect(applySettings).not.toHaveBeenCalled();
  });

  it("rejects a key outside the toss-invest namespace with 400", async () => {
    const res = await PUT(putRequest({ upserts: [{ key: "evil:key", value: "x" }] }));
    expect(res.status).toBe(400);
    expect(applySettings).not.toHaveBeenCalled();
  });

  it("rejects a value over the size cap with 400", async () => {
    const value = "x".repeat(64 * 1024 + 1);
    const res = await PUT(putRequest({ upserts: [{ key: "toss-invest:blob", value }] }));
    expect(res.status).toBe(400);
    expect(applySettings).not.toHaveBeenCalled();
  });

  it("rejects more than 100 upserts with 400", async () => {
    const upserts = Array.from({ length: 101 }, (_, i) => ({
      key: `toss-invest:k${i}`,
      value: "v",
    }));
    const res = await PUT(putRequest({ upserts }));
    expect(res.status).toBe(400);
    expect(applySettings).not.toHaveBeenCalled();
  });

  it("maps a SettingsLimitError from the store to 400", async () => {
    applySettings.mockImplementation(() => {
      throw new SettingsLimitError("too many keys");
    });
    const res = await PUT(putRequest({ upserts: [{ key: "toss-invest:x", value: "v" }] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Settings key limit exceeded");
  });
});
