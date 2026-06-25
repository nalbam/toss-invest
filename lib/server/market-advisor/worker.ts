import "server-only";
import { checkpointWal } from "@/lib/server/db/sqlite";
import { getServerLlmProvider, LlmNotConfiguredError } from "@/lib/server/llm/container";
import { getServerNewsSearch } from "@/lib/server/news/container";
import { getServerTossClient } from "@/lib/server/toss/container";
import { runAdvisorJobsOnce } from "./jobs";

// In-process background worker: ticks on an interval and runs one advisor pass.
// Started from instrumentation.ts so `pnpm dev` brings it up with the server and
// Ctrl+C tears it down together. The per-item due/skip logic lives in jobs.ts —
// the worker just provides the standing tick (kept out of jobs by design).

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  let provider;
  try {
    provider = getServerLlmProvider();
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return; // LLM not configured — nothing to do, stay quiet.
    }
    throw error;
  }
  try {
    const summary = await runAdvisorJobsOnce({
      client: getServerTossClient(),
      provider,
      newsSearch: getServerNewsSearch() ?? undefined,
    });
    if (summary.analyzed > 0) {
      console.log(`[advisor-worker] analyzed ${summary.analyzed} item(s)`);
    }
  } catch (error) {
    console.error("[advisor-worker] tick failed:", error);
  }
  // Keep the WAL file from growing without bound (the worker is the main writer).
  checkpointWal();
}

/** Starts the standing tick once. Subsequent calls are no-ops. */
export function startAdvisorWorker(): void {
  if (timer !== null) {
    return;
  }
  const tickMs = Number(process.env.ADVISOR_WORKER_TICK_MS ?? 60_000);
  timer = setInterval(() => void tick(), tickMs);
  // Don't let the timer keep the process alive on its own.
  timer.unref?.();
  console.log(`[advisor-worker] started (tick ${tickMs}ms)`);
}
