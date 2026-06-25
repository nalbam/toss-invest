import "server-only";
import { aggregateCandles, sourceInterval, type ChartInterval } from "@/lib/client/candles";
import { summarizeTrend, type TrendSummary } from "@/lib/client/indicators";
import { getCandlesCached } from "@/lib/server/candles/service";
import type { LlmProvider } from "@/lib/server/llm/types";
import type { ServerTossClient } from "@/lib/server/toss/container";
import { recordMarketAdvice } from "./history";
import { runMarketAdvisor } from "./market-advisor";
import { marketAdvisorJsonSchema } from "./schema";
import { latestCandleTimestamp } from "./timestamp";
import { listEnabledWatchlist, touchWatchlistRun, type WatchlistItem } from "./watchlist";

// Single-pass background job: analyze every enabled watchlist entry once. The
// server fetches candles itself (no client involvement), runs the market
// advisor, and records the result to SQLite. Per-item failures are isolated so
// one bad symbol does not abort the rest (mirrors the auto-executor pattern).
// Trigger (cron / script) is intentionally external — this is just one pass.

export interface AdvisorJobItemResult {
  symbol: string;
  interval: string;
  ok: boolean;
  decision?: string;
  error?: string;
  /** True when skipped because no new candle existed since the last analysis. */
  skipped?: boolean;
}

export interface AdvisorJobsSummary {
  processed: number;
  analyzed: number;
  results: AdvisorJobItemResult[];
}

/** Whether an item is due for re-analysis based on its per-item period. */
function isDue(item: WatchlistItem, now: number): boolean {
  if (item.lastRunAt === null) {
    return true;
  }
  const last = Date.parse(item.lastRunAt);
  if (Number.isNaN(last)) {
    return true;
  }
  return now - last >= item.runEveryMinutes * 60_000;
}

export interface RunAdvisorJobsDeps {
  client: ServerTossClient;
  provider: LlmProvider;
}

export async function runAdvisorJobsOnce(
  deps: RunAdvisorJobsDeps,
): Promise<AdvisorJobsSummary> {
  const items = listEnabledWatchlist();
  const now = Date.now();
  const due = items.filter((item) => isDue(item, now));
  const results: AdvisorJobItemResult[] = [];
  if (due.length === 0) {
    return { processed: items.length, analyzed: 0, results };
  }
  const positions = await loadPositions(deps.client);

  for (const item of due) {
    try {
      const interval = item.interval as ChartInterval;
      const page = await getCandlesCached(
        { symbol: item.symbol, interval: sourceInterval(interval) },
        { client: deps.client, now: () => now },
      );
      const candles = aggregateCandles(page.candles, interval).slice(-300);
      const latest = latestCandleTimestamp({ candles });
      if (latest === item.lastChartTimestamp) {
        // No new candle since the last analysis (e.g. market closed) — skip the
        // duplicate LLM call and only advance last_run_at.
        touchWatchlistRun(item.id, new Date(now).toISOString(), item.lastChartTimestamp);
        results.push({
          symbol: item.symbol,
          interval: item.interval,
          ok: true,
          skipped: true,
        });
        continue;
      }
      const lastPrice = candles.at(-1)?.closePrice;
      const higherTimeframeTrend = await loadHigherTimeframeTrend(
        deps.client,
        item,
        interval,
        now,
      );

      const result = await runMarketAdvisor({
        provider: deps.provider,
        request: {
          symbol: item.symbol,
          name: item.name ?? undefined,
          interval: item.interval,
          currency: item.currency,
          lastPrice,
          candles,
          position: positions.get(item.symbol),
          higherTimeframeTrend,
        },
        jsonSchema: marketAdvisorJsonSchema,
      });

      recordMarketAdvice({
        symbol: item.symbol,
        interval: item.interval,
        generatedAt: new Date().toISOString(),
        chartTimestamp: latest,
        lastPrice,
        decision: result.decision,
        advice: result.advice,
        annotations: result.annotations,
      });
      touchWatchlistRun(item.id, new Date(now).toISOString(), latest);

      results.push({
        symbol: item.symbol,
        interval: item.interval,
        ok: true,
        decision: result.decision.action,
      });
    } catch (error) {
      results.push({
        symbol: item.symbol,
        interval: item.interval,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const analyzed = results.filter((item) => item.ok && !item.skipped).length;
  return { processed: items.length, analyzed, results };
}

/**
 * Best-effort higher-timeframe (daily) trend summary for a sub-daily item, so a
 * minute-chart analysis is weighed against the larger trend. Daily+ items are
 * already their own highest timeframe → returns undefined (no extra fetch). Run
 * after the due/skip checks so skipped items incur no additional chart fetch.
 */
async function loadHigherTimeframeTrend(
  client: ServerTossClient,
  item: WatchlistItem,
  interval: ChartInterval,
  now: number,
): Promise<TrendSummary | undefined> {
  if (sourceInterval(interval) !== "1m") {
    return undefined;
  }
  try {
    const page = await getCandlesCached(
      { symbol: item.symbol, interval: "1d" },
      { client, now: () => now },
    );
    return summarizeTrend(page.candles.slice(-120), "1d") ?? undefined;
  } catch {
    // Higher-timeframe fetch failed → fall back to lower-timeframe-only analysis.
    return undefined;
  }
}

/**
 * Loads per-symbol position (quantity + average price) from the first account's
 * holdings so held watchlist symbols get profit/loss-aware advice. Best-effort:
 * any failure falls back to chart-only analysis.
 */
async function loadPositions(
  client: ServerTossClient,
): Promise<Map<string, { quantity: string; averagePrice: string }>> {
  const positions = new Map<string, { quantity: string; averagePrice: string }>();
  try {
    const accounts = await client.getAccounts();
    const first = accounts[0];
    if (!first) {
      return positions;
    }
    const holdings = await client.getHoldings({ accountSeq: first.accountSeq });
    for (const holding of holdings.items) {
      positions.set(holding.symbol, {
        quantity: holding.quantity,
        averagePrice: holding.averagePurchasePrice,
      });
    }
  } catch {
    // Holdings unavailable → fall back to chart-only analysis.
  }
  return positions;
}
