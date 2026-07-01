import "server-only";
import { NextResponse } from "next/server";
import { handleError } from "@/lib/server/api/respond";
import { ChatRequestError } from "@/lib/server/llm/chat-completions";
import { LlmNotConfiguredError } from "@/lib/server/llm/container";

/**
 * Cross-bundle-safe guards. Next.js may evaluate a module in separate registries,
 * so `instanceof` can miss an error minted in another bundle; fall back to the
 * stable `name` marker (mirrors `handleError`'s `TossApiError` handling).
 */
function isLlmNotConfiguredError(error: unknown): boolean {
  return (
    error instanceof LlmNotConfiguredError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "LlmNotConfiguredError")
  );
}

function isChatRequestError(error: unknown): boolean {
  return (
    error instanceof ChatRequestError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "ChatRequestError")
  );
}

/**
 * Maps an advisor/LLM error to a safe HTTP response, shared by the advisor
 * routes. `LlmNotConfiguredError` → 503 (misconfiguration); a failed provider
 * chat request (`ChatRequestError`) → 502 (bad upstream). Anything else is
 * delegated to `handleError` (upstream 4xx passthrough or generic 500).
 */
export function handleAdvisorError(error: unknown): NextResponse {
  if (isLlmNotConfiguredError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "advisor-not-configured",
          message: "AI advisor is not configured",
        },
      },
      { status: 503 },
    );
  }
  if (isChatRequestError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "market-advisor-failed",
          message: "AI market advisor request failed",
        },
      },
      { status: 502 },
    );
  }
  return handleError(error);
}
