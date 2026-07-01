// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSettingsStore,
  isSettingsHydrated,
  preloadSettings,
  setStoredItem,
} from "./settingsStore";

const fetchMock = vi.fn();

function okResponse() {
  return { ok: true, status: 200, json: async () => ({ data: {} }) };
}
function errResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

/** Body of the most recent PUT flush. */
function lastPutBody(): { upserts: unknown[]; deletes: unknown[] } {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
  return JSON.parse((call![1] as RequestInit).body as string);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  __resetSettingsStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetSettingsStore();
});

describe("settingsStore flush", () => {
  it("flushes a debounced PUT carrying the pending batch", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(okResponse());

    setStoredItem("k1", "v1");
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastPutBody()).toEqual({
      upserts: [{ key: "k1", value: "v1" }],
      deletes: [],
    });
  });

  it("re-queues and retries after a network failure", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    setStoredItem("k1", "v1");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(okResponse());
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastPutBody()).toEqual({
      upserts: [{ key: "k1", value: "v1" }],
      deletes: [],
    });
  });

  it("re-queues and retries on a transient 5xx", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(errResponse(503));

    setStoredItem("k1", "v1");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(okResponse());
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the batch without retrying on a deterministic 4xx", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(errResponse(400));

    setStoredItem("k1", "v1");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // No re-queue → no further flush even after more time passes.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("keeps a newer in-flight write when re-queuing a failed flush (last write wins)", async () => {
    vi.useFakeTimers();
    let rejectFlush!: (reason: unknown) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFlush = reject;
      }),
    );

    setStoredItem("k1", "v1");
    await vi.advanceTimersByTimeAsync(400); // flush starts; pending drained, fetch in-flight

    // A newer write for the same key arrives while the flush is in-flight.
    setStoredItem("k1", "v2");
    rejectFlush(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();

    fetchMock.mockResolvedValue(okResponse());
    await vi.advanceTimersByTimeAsync(400);

    expect(lastPutBody()).toEqual({
      upserts: [{ key: "k1", value: "v2" }],
      deletes: [],
    });
  });
});

describe("settingsStore preload", () => {
  it("hydrates even when the initial load fails (fail-open)", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await preloadSettings();
    expect(isSettingsHydrated()).toBe(true);
  });
});
