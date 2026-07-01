import "server-only";
import type { ServerTossClient } from "@/lib/server/toss/container";

/**
 * Resolves the account to act on: returns `provided` verbatim when the caller
 * supplied one, otherwise falls back to the first account. Returns `null` when
 * no account is available so the caller can surface a 400.
 */
export async function resolveAccountSeq(
  client: ServerTossClient,
  provided: number | string | undefined,
): Promise<number | string | null> {
  if (provided !== undefined) {
    return provided;
  }
  const accounts = await client.getAccounts();
  const first = accounts[0];
  return first ? first.accountSeq : null;
}
