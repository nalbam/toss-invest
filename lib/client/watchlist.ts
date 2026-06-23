"use client";

import useSWR from "swr";
import { isErrorEnvelope, isSuccessEnvelope } from "./envelope";
import { ApiClientError } from "./hooks";

// Client types + fetcher/mutations for the background-advisor watchlist
// (GET/POST/PATCH/DELETE /api/advisor-watchlist).

export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string | null;
  interval: string;
  currency: string;
  enabled: boolean;
  runEveryMinutes: number;
  lastRunAt: string | null;
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

export function useWatchlist() {
  const { data, error, isLoading, mutate } = useSWR<
    { items: WatchlistItem[] },
    ApiClientError
  >("/api/advisor-watchlist", (url: string) =>
    request<{ items: WatchlistItem[] }>(url),
  );
  return { items: data?.items ?? [], error, isLoading, mutate };
}

export interface AddWatchlistInput {
  symbol: string;
  name?: string;
  interval: string;
  currency?: string;
  runEveryMinutes?: number;
}

export function addWatchlistItem(input: AddWatchlistInput): Promise<{ item: WatchlistItem }> {
  return request<{ item: WatchlistItem }>("/api/advisor-watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function removeWatchlistItem(id: number): Promise<unknown> {
  return request<unknown>(`/api/advisor-watchlist?id=${id}`, { method: "DELETE" });
}

export function setWatchlistItemEnabled(
  id: number,
  enabled: boolean,
): Promise<unknown> {
  return request<unknown>("/api/advisor-watchlist", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, enabled }),
  });
}

export function setWatchlistItemRunEvery(
  id: number,
  runEveryMinutes: number,
): Promise<unknown> {
  return request<unknown>("/api/advisor-watchlist", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, runEveryMinutes }),
  });
}
