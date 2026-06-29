import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic login gate. Edge-safe: it only checks for the presence of the
 * better-auth session cookie (no DB access) and redirects unauthenticated
 * requests to /login. Real session validation happens server-side in the page
 * (`app/page.tsx` calls `auth.api.getSession`) — a forged cookie passes this
 * check but never reaches authenticated data.
 */
export function middleware(request: NextRequest): NextResponse {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Gate everything except /login, the auth API, and static assets.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
