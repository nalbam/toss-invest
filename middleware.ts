import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic login gate for **page** navigations. Edge-safe: it only checks for
 * the presence of the better-auth session cookie (no DB access) and redirects
 * unauthenticated requests to /login. Real session validation happens
 * server-side — `app/page.tsx` calls `auth.api.getSession`, and every `/api/*`
 * route re-validates via `withAuth` (returning 401 JSON). A forged cookie passes
 * this presence check but never reaches authenticated data.
 *
 * `/api/*` is intentionally excluded from the matcher: API auth is owned by
 * `withAuth` so a missing/expired session yields a 401 JSON envelope (which
 * fetch callers can parse) rather than a 302 redirect to an HTML login page.
 */
export function middleware(request: NextRequest): NextResponse {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Gate page routes only — exclude /login, all of /api (handled by withAuth),
  // and static assets.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
