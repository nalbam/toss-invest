import "server-only";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "@/lib/auth";

/**
 * Creates any missing better-auth tables (user/session/account/verification) in
 * the auth SQLite file. better-auth never creates its schema at request time, so
 * a fresh DB (e.g. a brand-new mounted volume) would otherwise fail every auth
 * call with "no such table". Run once at server boot from instrumentation.
 *
 * Idempotent: getMigrations diffs the live schema and only emits the missing
 * pieces, so re-running on every boot is a no-op once the tables exist.
 */
export async function runAuthMigrations(): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
