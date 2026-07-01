import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db/sqlite", () => ({ checkpointWal: vi.fn() }));
vi.mock("@/lib/server/llm/container", () => ({
  getServerLlmProvider: () => ({ name: "fake" }),
  LlmNotConfiguredError: class extends Error {},
}));
vi.mock("@/lib/server/news/container", () => ({
  getServerNewsSearch: () => undefined,
}));
vi.mock("@/lib/server/toss/container", () => ({
  getServerTossClient: () => ({}),
}));

const runAdvisorJobsOnce = vi.fn();
vi.mock("./jobs", () => ({
  runAdvisorJobsOnce: (...args: unknown[]) => runAdvisorJobsOnce(...args),
}));

import { tick } from "./worker";

describe("advisor worker tick re-entrancy", () => {
  afterEach(() => {
    runAdvisorJobsOnce.mockReset();
  });

  it("skips an overlapping tick while a pass is still in flight", async () => {
    let resolvePass!: () => void;
    runAdvisorJobsOnce.mockReturnValue(
      new Promise<{ analyzed: number }>((resolve) => {
        resolvePass = () => resolve({ analyzed: 0 });
      }),
    );

    const first = tick(); // starts the pass — running becomes true
    await tick(); // overlapping tick — guarded, must not start a second pass
    expect(runAdvisorJobsOnce).toHaveBeenCalledTimes(1);

    resolvePass();
    await first;

    // Once the previous pass finished, the next tick runs normally again.
    runAdvisorJobsOnce.mockResolvedValue({ analyzed: 0 });
    await tick();
    expect(runAdvisorJobsOnce).toHaveBeenCalledTimes(2);
  });
});
