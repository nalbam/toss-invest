import "server-only";

export type {
  BacktestInput,
  BacktestResult,
  BacktestSymbolInput,
  BacktestTrade,
} from "@/lib/server/trading/backtest/types";
export { runBacktest } from "@/lib/server/trading/backtest/simulate";
