import "server-only";
import { redisCommand } from "./redis";

const KEY_PREFIX = process.env.CACHE_KEY_PREFIX ?? "toss-invest:v1";
const PRICE_LIMIT = 5_000;
const CANDLE_LIMIT = 5_000;
const ADVICE_LIMIT = 1_000;

interface PriceLike {
  symbol: string;
  lastPrice: string;
  currency: string;
}

interface CandleLike {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: string;
}

interface MarketAdviceRecord {
  symbol: string;
  interval: string;
  generatedAt: string;
  chartTimestamp: string | null;
  lastPrice?: string;
  decision: {
    action: "buy" | "sell" | "hold" | "wait";
    label: string;
    reason: string;
  };
  advice: string;
}

export interface MarketAdviceHistoryRecord extends MarketAdviceRecord {
  cachedAt: string;
}

function key(...parts: string[]): string {
  return [KEY_PREFIX, ...parts].join(":");
}

async function bestEffort(command: Array<string | number>): Promise<void> {
  try {
    await redisCommand(command);
  } catch {
    // Cache is best-effort. Upstream API responses must not fail because Redis is down.
  }
}

async function appendJson(
  redisKey: string,
  value: unknown,
  limit: number,
): Promise<void> {
  await bestEffort(["LPUSH", redisKey, JSON.stringify(value)]);
  await bestEffort(["LTRIM", redisKey, 0, limit - 1]);
}

export async function recordPriceSnapshots(prices: PriceLike[]): Promise<void> {
  const capturedAt = new Date().toISOString();
  await Promise.all(
    prices.map((price) =>
      appendJson(key("prices", price.symbol), { ...price, capturedAt }, PRICE_LIMIT),
    ),
  );
}

export async function recordCandleSnapshot(
  symbol: string,
  interval: string,
  candles: CandleLike[],
): Promise<void> {
  await appendJson(
    key("candles", symbol, interval),
    { symbol, interval, capturedAt: new Date().toISOString(), candles },
    CANDLE_LIMIT,
  );
}

export async function recordMarketAdvice(
  record: MarketAdviceRecord,
): Promise<void> {
  await appendJson(
    key("market-advice", record.symbol),
    { ...record, cachedAt: new Date().toISOString() },
    ADVICE_LIMIT,
  );
}

export async function readMarketAdviceHistory({
  symbol,
  interval,
  limit,
}: {
  symbol: string;
  interval?: string;
  limit: number;
}): Promise<MarketAdviceHistoryRecord[]> {
  let raw: unknown;
  try {
    raw = await redisCommand([
      "LRANGE",
      key("market-advice", symbol),
      0,
      Math.max(0, limit - 1),
    ]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item): MarketAdviceHistoryRecord[] => {
      if (typeof item !== "string") return [];
      try {
        const parsed: unknown = JSON.parse(item);
        if (!isMarketAdviceHistoryRecord(parsed)) return [];
        if (interval !== undefined && parsed.interval !== interval) return [];
        return [parsed];
      } catch {
        return [];
      }
    })
    .slice(0, limit);
}

function isMarketAdviceHistoryRecord(
  value: unknown,
): value is MarketAdviceHistoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<MarketAdviceHistoryRecord>;
  const decision = record.decision;
  return (
    typeof record.symbol === "string" &&
    typeof record.interval === "string" &&
    typeof record.generatedAt === "string" &&
    (typeof record.chartTimestamp === "string" || record.chartTimestamp === null) &&
    typeof record.cachedAt === "string" &&
    typeof record.advice === "string" &&
    typeof decision === "object" &&
    decision !== null &&
    (decision.action === "buy" ||
      decision.action === "sell" ||
      decision.action === "hold" ||
      decision.action === "wait") &&
    typeof decision.label === "string" &&
    typeof decision.reason === "string"
  );
}

