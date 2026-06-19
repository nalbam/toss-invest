import "server-only";
import { thresholdExitStrategy } from "@/lib/server/trading/strategy/threshold-exit";
import type {
  OrderIntent,
  PositionSnapshot,
  StrategySnapshot,
} from "@/lib/server/trading/strategy/types";
import type {
  BacktestInput,
  BacktestResult,
  BacktestSymbolInput,
  BacktestTrade,
} from "@/lib/server/trading/backtest/types";

/**
 * Pure, deterministic backtest. Replays `input.strategy` (default
 * `thresholdExitStrategy`) over each symbol's `closes` series against a virtual
 * portfolio, applying every proposed SELL and tallying realized PnL in KRW.
 *
 * Per step t (t = 0..N-1, N = the *shortest* series across symbols so every
 * symbol has a close at each step):
 *   - For each symbol still holding shares (qty > 0): value it at `closes[t]`.
 *     `profitLossRate = (close - avgCost) / avgCost` (a currency-independent
 *     ratio); `dailyProfitLossRate` is vs. the previous step's close (0 at t=0).
 *   - KRW market value = qty * close, times `fxRate` for USD; `weightPct` is the
 *     symbol's KRW value over the total KRW value * 100.
 *   - Build a `StrategySnapshot`, call the strategy, and apply the returned SELL
 *     intents: `soldQty = min(intent.quantity, held)`, decrementing the holding
 *     and adding `soldQty * (close - avgCost)` (USD via `fxRate`) to realized
 *     PnL. Each applied sell is recorded as a `BacktestTrade`.
 *
 * fxRate handling: a USD symbol with no `fxRate` cannot be valued in KRW, so it
 * is *excluded* from the run entirely (no trades, no PnL) and listed in
 * `metrics.skippedSymbols`. KRW symbols never need a rate.
 *
 * avgCost simplification: `avgCost` is held constant for the whole run, even
 * after a partial sell (no recompute of the average on the remaining lot). This
 * keeps the harness a pure replay of the strategy's exit rules rather than a
 * cost-basis accounting engine.
 *
 * Determinism: the result is a function of `input` alone — no clock, no
 * randomness, no I/O. Trades are emitted in (step, symbol) order because steps
 * are processed in ascending order and the strategy returns symbol-sorted
 * intents.
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  const strategy = input.strategy ?? thresholdExitStrategy;

  // Partition inputs: USD symbols with no FX rate cannot be valued in KRW and
  // are skipped (recorded for transparency in metrics.skippedSymbols).
  const active: BacktestSymbolInput[] = [];
  const skippedSymbols: string[] = [];
  for (const symbol of input.symbols) {
    if (symbol.currency === "USD" && input.fxRate === undefined) {
      skippedSymbols.push(symbol.symbol);
    } else {
      active.push(symbol);
    }
  }
  skippedSymbols.sort(compareString);

  // Mutable virtual-portfolio state, keyed by symbol. `quantity` shrinks as
  // sells are applied; `avgCost` stays constant (see the simplification above).
  const holdings = new Map<string, SymbolState>();
  for (const symbol of active) {
    holdings.set(symbol.symbol, {
      input: symbol,
      quantity: Math.max(0, Math.floor(Number(symbol.initialQuantity))),
    });
  }

  // Steps run only as far as the shortest series so every active symbol has a
  // close at each step (length mismatch => trim to the shortest).
  const stepCount = shortestLength(active);

  const trades: BacktestTrade[] = [];
  let realizedPnlKrw = 0;

  for (let step = 0; step < stepCount; step += 1) {
    const fxRate = input.fxRate;
    const valued = valueHoldings(holdings, step, fxRate);
    const totalKrwValue = valued.reduce((sum, v) => sum + v.krwValue, 0);

    const positions: PositionSnapshot[] = valued.map((v) =>
      toPositionSnapshot(v, step, totalKrwValue),
    );
    const snapshot: StrategySnapshot = { positions };
    const intents = strategy(snapshot, input.params);

    for (const intent of intents) {
      const applied = applySell(intent, holdings, step, fxRate);
      if (applied !== undefined) {
        trades.push(applied);
        realizedPnlKrw += applied.realizedPnlKrw;
      }
    }
  }

  return buildResult(active, holdings, trades, realizedPnlKrw, skippedSymbols);
}

/** Mutable per-symbol state during the replay. */
interface SymbolState {
  input: BacktestSymbolInput;
  quantity: number;
}

/** A symbol valued at a given step (native + KRW). */
interface ValuedSymbol {
  symbol: string;
  state: SymbolState;
  close: number;
  prevClose: number | undefined;
  /** KRW market value; 0 when it cannot be valued (USD without `fxRate`). */
  krwValue: number;
  /** True when the KRW value could not be computed (USD without `fxRate`). */
  krwUnknown: boolean;
}

/** Native -> KRW: KRW symbols pass through; USD needs a finite `fxRate`. */
function nativeToKrw(
  nativeAmount: number,
  currency: "KRW" | "USD",
  fxRate: number | undefined,
): number | undefined {
  if (currency === "KRW") return nativeAmount;
  if (fxRate === undefined || !Number.isFinite(fxRate)) return undefined;
  return nativeAmount * fxRate;
}

/** Values every still-held symbol at `step`, skipping zero-quantity holdings. */
function valueHoldings(
  holdings: Map<string, SymbolState>,
  step: number,
  fxRate: number | undefined,
): ValuedSymbol[] {
  const valued: ValuedSymbol[] = [];
  for (const state of holdings.values()) {
    if (state.quantity <= 0) continue;
    const close = Number(state.input.closes[step]);
    const prevClose = step > 0 ? Number(state.input.closes[step - 1]) : undefined;
    const krw = nativeToKrw(state.quantity * close, state.input.currency, fxRate);
    valued.push({
      symbol: state.input.symbol,
      state,
      close,
      prevClose,
      krwValue: krw ?? 0,
      krwUnknown: krw === undefined,
    });
  }
  return valued;
}

/** Builds the strategy snapshot entry for a valued symbol. */
function toPositionSnapshot(
  valued: ValuedSymbol,
  step: number,
  totalKrwValue: number,
): PositionSnapshot {
  const { state, close, prevClose } = valued;
  const avgCost = Number(state.input.avgCost);
  const profitLossRate = (close - avgCost) / avgCost;
  const dailyProfitLossRate =
    step === 0 || prevClose === undefined ? 0 : (close - prevClose) / prevClose;
  // A symbol whose KRW value is unknown gets weightPct 0 (no trim); its
  // ratio-based stop-loss / take-profit rules are unaffected by weight.
  const weightPct =
    valued.krwUnknown || totalKrwValue <= 0
      ? 0
      : (valued.krwValue / totalKrwValue) * 100;

  return {
    symbol: state.input.symbol,
    currency: state.input.currency,
    quantity: String(state.quantity),
    profitLossRate,
    dailyProfitLossRate,
    weightPct,
    lastPrice: state.input.closes[step],
  };
}

/**
 * Applies one SELL intent to the virtual portfolio, returning the recorded
 * trade or undefined when nothing is sold (unknown symbol, zero held, or a
 * zero/invalid intent quantity).
 */
function applySell(
  intent: OrderIntent,
  holdings: Map<string, SymbolState>,
  step: number,
  fxRate: number | undefined,
): BacktestTrade | undefined {
  if (intent.side !== "SELL") return undefined;
  const state = holdings.get(intent.symbol);
  if (state === undefined || state.quantity <= 0) return undefined;

  const requested = Math.floor(Number(intent.quantity));
  if (!Number.isFinite(requested) || requested <= 0) return undefined;

  const soldQty = Math.min(requested, state.quantity);
  state.quantity -= soldQty;

  const close = Number(state.input.closes[step]);
  const avgCost = Number(state.input.avgCost);
  // Native PnL converted to KRW; an unknown-KRW symbol would already have been
  // skipped before the run, so the conversion is always defined here.
  const realizedPnlKrw =
    nativeToKrw(soldQty * (close - avgCost), state.input.currency, fxRate) ?? 0;

  return {
    step,
    symbol: intent.symbol,
    side: "SELL",
    quantity: String(soldQty),
    price: state.input.closes[step],
    reason: intent.reason,
    realizedPnlKrw,
  };
}

/** Aggregates final positions and per-symbol metrics from the recorded trades. */
function buildResult(
  active: BacktestSymbolInput[],
  holdings: Map<string, SymbolState>,
  trades: BacktestTrade[],
  realizedPnlKrw: number,
  skippedSymbols: string[],
): BacktestResult {
  const finalPositions = active
    .map((symbol) => ({
      symbol: symbol.symbol,
      quantity: String(holdings.get(symbol.symbol)?.quantity ?? 0),
    }))
    .sort((a, b) => compareString(a.symbol, b.symbol));

  const bySymbol: Record<string, { sold: string; realizedPnlKrw: number }> = {};
  for (const trade of trades) {
    const entry = bySymbol[trade.symbol] ?? { sold: "0", realizedPnlKrw: 0 };
    bySymbol[trade.symbol] = {
      sold: String(Number(entry.sold) + Number(trade.quantity)),
      realizedPnlKrw: entry.realizedPnlKrw + trade.realizedPnlKrw,
    };
  }

  return {
    trades,
    finalPositions,
    realizedPnlKrw,
    metrics: {
      tradeCount: trades.length,
      realizedPnlKrw,
      bySymbol,
      skippedSymbols,
    },
  };
}

/** Shortest `closes` length across the active symbols (0 when none). */
function shortestLength(symbols: BacktestSymbolInput[]): number {
  if (symbols.length === 0) return 0;
  let min = symbols[0].closes.length;
  for (const symbol of symbols) {
    if (symbol.closes.length < min) min = symbol.closes.length;
  }
  return min;
}

/** Stable ascending string comparator (no locale dependence). */
function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
