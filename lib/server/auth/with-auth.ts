import "server-only";
import { auth } from "@/lib/auth";
import { unauthorized } from "@/lib/server/api/respond";

/**
 * Wraps an API route handler so every request is authenticated server-side. The
 * edge `middleware.ts` only checks for the session cookie's presence (a forged
 * cookie passes it), so each `/api/*` handler must re-validate the session here
 * with the same `auth.api.getSession` the dashboard page uses. Unauthenticated
 * requests get a 401 and never reach the handler (Toss data, order execution).
 *
 * The second argument (Next.js route context, e.g. `{ params }`) is passed
 * through untouched so dynamic routes keep their typing.
 */
export function withAuth(
  handler: (request: Request) => Promise<Response>,
): (request: Request, ctx?: unknown) => Promise<Response>;
export function withAuth<Ctx>(
  handler: (request: Request, ctx: Ctx) => Promise<Response>,
): (request: Request, ctx: Ctx) => Promise<Response>;
export function withAuth<Ctx>(
  handler: (request: Request, ctx: Ctx) => Promise<Response>,
): (request: Request, ctx: Ctx) => Promise<Response> {
  return async (request, ctx) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return unauthorized();
    }
    return handler(request, ctx);
  };
}
