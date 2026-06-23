import "server-only";
import { getEnv } from "@/lib/server/env";
import { isKrwSymbol } from "@/lib/server/trading/symbol";
import type { TossClient } from "@/lib/server/toss/client";
import {
  createOrderRaw,
  getExchangeRate,
  getPrices,
} from "@/lib/server/toss/endpoints";
import {
  runAutoTrade,
  type AutoTradeResult,
} from "@/lib/server/trading/auto-executor";
import { getTradingConfig, type AuditEntry } from "@/lib/server/trading/safety";
import type { OrderIntent } from "@/lib/server/trading/strategy/types";

/**
 * Gated auto-trader facade. It binds the §6 auto-executor (`runAutoTrade`) to
 * the live raw `POST /orders`, the resolved trading config, a wall clock, a
 * secret-free audit logger, and the live market-data lookups it needs to value
 * MARKET orders. The raw POST is reachable ONLY through the §6 gate inside
 * `placeOrder`; this facade never bypasses it.
 *
 * SAFETY: the per-order `confirm` is `AUTO_TRADE_ENABLED` read from env, passed
 * through verbatim. This facade NEVER mints or promotes a confirm. There is no
 * standing loop / cron here — `runOnce` does a single evaluation pass per call.
 * A human trigger / schedule is a separate, later decision (not wired here).
 */
export interface ServerAutoTrader {
  /**
   * Evaluates the given intents through the §6 gate exactly once and returns the
   * per-intent decisions + summary. Resolves the data the gate needs to value
   * each order (a native reference price for MARKET intents, and the USD->KRW
   * rate when any intent is a USD symbol); a lookup that fails is left
   * `undefined` so the gate fails safe and BLOCKs rather than valuing on a guess.
   */
  runOnce(
    accountSeq: number | string,
    intents: OrderIntent[],
  ): Promise<AutoTradeResult>;
}

/**
 * Secret-free audit logger (same shape as the executor facade). `safety.ts`
 * already strips auth material, so only the order summary, decision, reasons,
 * and notional are recorded.
 */
function auditLog(entry: AuditEntry): void {
  console.info("[auto-trade-audit]", JSON.stringify(entry));
}

/**
 * Resolves native-currency reference prices for the MARKET intents' symbols,
 * returning a `symbol -> price` map. A symbol whose price cannot be read (or is
 * non-finite) is omitted, so the synchronous `priceFor` returns `undefined` and
 * the gate BLOCKs that order. LIMIT intents are valued from their own price and
 * need no lookup.
 */
async function resolveReferencePrices(
  client: TossClient,
  intents: OrderIntent[],
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const symbols = Array.from(
    new Set(
      intents
        .filter((intent) => intent.orderType === "MARKET")
        .map((intent) => intent.symbol),
    ),
  );
  if (symbols.length === 0) return prices;

  try {
    const quotes = await getPrices(client, { symbols });
    for (const quote of quotes) {
      const price = Number(quote.lastPrice);
      if (Number.isFinite(price)) prices.set(quote.symbol, price);
    }
  } catch {
    // Leave the map empty so every MARKET order fails safe (notional-unknown).
  }
  return prices;
}

/**
 * Resolves the USD->KRW rate when any intent is a USD (non-KRW) symbol, else
 * `undefined`. A lookup failure or non-finite rate yields `undefined`, so a USD
 * order is BLOCKed rather than under-valued as KRW.
 */
async function resolveFxRate(
  client: TossClient,
  intents: OrderIntent[],
): Promise<number | undefined> {
  const hasUsd = intents.some((intent) => !isKrwSymbol(intent.symbol));
  if (!hasUsd) return undefined;
  try {
    const fx = await getExchangeRate(client, {
      baseCurrency: "USD",
      quoteCurrency: "KRW",
    });
    const rate = Number(fx.rate);
    return Number.isFinite(rate) ? rate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the gated auto-trader over a live Toss client. The §6 gate runs inside
 * `placeOrder` (via `runAutoTrade`); this only injects I/O (raw POST, clock,
 * audit, market-data lookups) and reads the config + `AUTO_TRADE_ENABLED` per
 * call so a flipped env takes effect without a process restart.
 */
export function createServerAutoTrader(client: TossClient): ServerAutoTrader {
  const now = () => Date.now();
  return {
    runOnce: async (accountSeq, intents) => {
      const [prices, fxRate] = await Promise.all([
        resolveReferencePrices(client, intents),
        resolveFxRate(client, intents),
      ]);
      return runAutoTrade(intents, {
        config: getTradingConfig(),
        // The human's env activation, read fresh and passed through unchanged.
        autoTradeEnabled: getEnv().AUTO_TRADE_ENABLED,
        createOrderRaw: (params) => createOrderRaw(client, params),
        now,
        auditLog,
        accountSeq,
        priceFor: (symbol) => prices.get(symbol),
        fxRate,
      });
    },
  };
}
