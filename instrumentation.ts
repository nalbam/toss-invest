// Next.js runs register() once when the server boots (and tears it down with the
// server). We use it to start the in-process advisor worker so `pnpm dev` brings
// the background analysis up/down together with the dev server. Gated by
// ADVISOR_WORKER_ENABLED so other runtimes/processes stay opt-in.
export async function register(): Promise<void> {
  // The dynamic import MUST stay inside a positive `NEXT_RUNTIME === "nodejs"`
  // guard. Next.js also compiles this file for the Edge runtime, where webpack
  // folds the condition to `false` and drops the import — keeping the native
  // (better-sqlite3 / node:fs) worker chain out of the Edge bundle. An early
  // `return` guard does NOT achieve this: webpack still registers the import.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.ADVISOR_WORKER_ENABLED === "true"
  ) {
    const { startAdvisorWorker } = await import(
      "@/lib/server/market-advisor/worker"
    );
    startAdvisorWorker();
  }
}
