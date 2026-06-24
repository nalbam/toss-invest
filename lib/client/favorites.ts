"use client";

import useSWR from "swr";
import { isErrorEnvelope, isSuccessEnvelope } from "./envelope";
import { ApiClientError } from "./hooks";

// Client types + fetcher/mutations for the favorites list
// (GET/POST/DELETE /api/favorites).

export interface Favorite {
  id: number;
  symbol: string;
  name: string | null;
  currency: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unreadable response.",
      status: res.status,
    });
  }
  if (!res.ok || isErrorEnvelope(body)) {
    if (isErrorEnvelope(body)) {
      throw new ApiClientError({
        code: body.error.code,
        message: body.error.message,
        status: res.status,
        requestId: body.error.requestId,
      });
    }
    throw new ApiClientError({
      code: "unexpected-error",
      message: `Request failed with status ${res.status}.`,
      status: res.status,
    });
  }
  if (!isSuccessEnvelope<T>(body)) {
    throw new ApiClientError({
      code: "invalid-response",
      message: "The server returned an unexpected response shape.",
      status: res.status,
    });
  }
  return body.data;
}

export function useFavorites() {
  const { data, error, isLoading, mutate } = useSWR<
    { items: Favorite[] },
    ApiClientError
  >("/api/favorites", (url: string) => request<{ items: Favorite[] }>(url));
  return { items: data?.items ?? [], error, isLoading, mutate };
}

export interface AddFavoriteInput {
  symbol: string;
  name?: string;
  currency?: string;
}

export function addFavoriteItem(
  input: AddFavoriteInput,
): Promise<{ item: Favorite }> {
  return request<{ item: Favorite }>("/api/favorites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function removeFavoriteItem(symbol: string): Promise<unknown> {
  return request<unknown>(
    `/api/favorites?symbol=${encodeURIComponent(symbol)}`,
    { method: "DELETE" },
  );
}
