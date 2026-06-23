// Shared response-envelope guards for the JSON API ({ data } | { error }). The
// fetch wrappers (advisor.ts, market-advisor.ts) narrow the parsed body with
// these before reading `data` or throwing an ApiClientError.

export interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string };
}

export function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }
  const error = (body as { error: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    typeof record.message === "string" &&
    (record.requestId === undefined || typeof record.requestId === "string")
  );
}

export function isSuccessEnvelope<T>(body: unknown): body is { data: T } {
  return typeof body === "object" && body !== null && "data" in body;
}
