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
  // Value every holding in KRW before weighting so a mixed KRW+USD portfolio
  // isn't skewed by summing raw amounts across currencies (mirrors
  // PortfolioComposition). USD is only valued when an fx rate is available;
  // without one it's left out of the weight basis (weight 0) rather than mixed.
  const fxRate =
    inputs.exchangeRate && toAmount(inputs.exchangeRate.rate) > 0
      ? toAmount(inputs.exchangeRate.rate)
      : null;
  const valueInKrw = (item: (typeof items)[number]): number | null => {
    const amount = toAmount(item.marketValue.amount);
    if (item.currency === "USD") {
      return fxRate !== null ? amount * fxRate : null;
    }
    return amount;
  };
  const totalMarketValue = items.reduce((sum, item) => {
    const value = valueInKrw(item);
    return value !== null ? sum + value : sum;
  }, 0);

  const holdings: SnapshotHolding[] = items.map((item) => {
    const value = valueInKrw(item);
    const weightPercent =
      value !== null && totalMarketValue > 0
        ? Number(((value / totalMarketValue) * 100).toFixed(2))
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
