import "server-only";
import type {
  BuyingPowerResponse,
  ExchangeRateResponse,
  HoldingsOverview,
} from "@/lib/server/toss/schemas";

// Masked portfolio snapshot sent to the LLM. Built from scratch as object
// literals (never by spreading raw domain objects), so only the whitelisted
// fields below can ever reach the provider — account identifiers (accountNo /
// accountSeq / accountType) and any other PII are excluded by construction (§7).

export interface SnapshotHolding {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue: string;
  profitLoss: string;
  profitLossRate: string;
  /** Position weight as a percentage of total market value (0..100, 2 dp). */
  weightPercent: number;
}

export interface SnapshotCash {
  currency: string;
  buyingPower: string;
}

export interface SnapshotExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
}

export interface AdvisorSnapshot {
  holdings: SnapshotHolding[];
  cash: SnapshotCash;
  exchangeRate: SnapshotExchangeRate | null;
}

export interface RawAdvisorInputs {
  holdings: HoldingsOverview;
  buyingPower: BuyingPowerResponse;
  exchangeRate?: ExchangeRateResponse | null;
}

/** Parses a decimal-string amount, treating non-finite values as 0. */
function toAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Pure transform: raw portfolio/market data → masked snapshot. Deterministic
 * (no clock/network), so it is fully unit-tested. Weights are computed from the
 * sum of holding market values to avoid trusting a separate total field.
 */
export function buildAdvisorSnapshot(inputs: RawAdvisorInputs): AdvisorSnapshot {
  const items = inputs.holdings.items;
  const totalMarketValue = items.reduce(
    (sum, item) => sum + toAmount(item.marketValue.amount),
    0,
  );

  const holdings: SnapshotHolding[] = items.map((item) => {
    const amount = toAmount(item.marketValue.amount);
    const weightPercent =
      totalMarketValue > 0
        ? Number(((amount / totalMarketValue) * 100).toFixed(2))
        : 0;
    return {
      symbol: item.symbol,
      name: item.name,
      market: item.marketCountry,
      currency: item.currency,
      quantity: item.quantity,
      lastPrice: item.lastPrice,
      averagePurchasePrice: item.averagePurchasePrice,
      marketValue: item.marketValue.amount,
      profitLoss: item.profitLoss.amount,
      profitLossRate: item.profitLoss.rate,
      weightPercent,
    };
  });

  const exchangeRate: SnapshotExchangeRate | null = inputs.exchangeRate
    ? {
        baseCurrency: inputs.exchangeRate.baseCurrency,
        quoteCurrency: inputs.exchangeRate.quoteCurrency,
        rate: inputs.exchangeRate.rate,
      }
    : null;

  return {
    holdings,
    cash: {
      currency: inputs.buyingPower.currency,
      buyingPower: inputs.buyingPower.cashBuyingPower,
    },
    exchangeRate,
  };
}
