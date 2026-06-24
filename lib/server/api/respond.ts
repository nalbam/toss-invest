import "server-only";
import { NextResponse } from "next/server";
import { TossApiError } from "@/lib/server/toss/client";

/**
 * Error envelope returned to the browser. Only safe, caller-actionable fields
 * are included: an upstream error `code`, a vetted `message`, and the upstream
 * `requestId` for support. Internal stack traces and secrets never appear here.
 */
interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

/** Wraps a successful result in the `{ data }` envelope with a 200 status. */
export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 200 });
}

/** 400 for query/body validation failures. `message` must be caller-safe. */
export function invalidRequest(message: string): NextResponse {
  const body: ApiErrorBody = {
    error: { code: "invalid-request", message },
  };
  return NextResponse.json(body, { status: 400 });
}

/**
 * Cross-bundle-safe `TossApiError` check. Next.js may evaluate `client.ts` in
 * separate module registries (route vs instrumentation bundles), and the Toss
 * client is a `globalThis` singleton, so an error it throws can be a
 * `TossApiError` whose class identity differs from this module's import —
 * `instanceof` then returns false. Fall back to the stable `name` marker so an
 * upstream 4xx is forwarded with its status instead of masked as a 500.
 */
function isTossApiError(error: unknown): error is TossApiError {
  return (
    error instanceof TossApiError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "TossApiError")
  );
}

/**
 * Maps a thrown error to a safe HTTP response. `TossApiError` is forwarded with
 * its upstream status, `code`, `message`, and `requestId`. Anything else becomes
 * a generic 500 so internal details (stack traces, secrets) are never leaked.
 */
export function handleError(error: unknown): NextResponse {
  if (isTossApiError(error)) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        requestId: error.requestId,
      },
    };
    return NextResponse.json(body, { status: error.status });
  }
  // Log server-side so an opaque 500 is diagnosable (e.g. a config/env failure).
  // The client response stays generic; this never reaches the browser.
  console.error("[api] unhandled error:", error);
  const body: ApiErrorBody = {
    error: { code: "internal-error", message: "Internal server error" },
  };
  return NextResponse.json(body, { status: 500 });
}
