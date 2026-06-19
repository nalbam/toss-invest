"use client";

export const API_GROUP_TPS = {
  ACCOUNT: 1,
  ASSET: 5,
  MARKET_DATA: 10,
  MARKET_DATA_CHART: 5,
  MARKET_INFO: 3,
  ORDER_HISTORY: 5,
  ORDER_INFO: 6,
} as const;

export const POLLING_INTERVAL_MS = {
  account: 60_000,
  holdings: 2_000,
  orders: 5_000,
  prices: 1_000,
  priceLimits: 60_000,
  orderbook: 1_000,
  candles: 10_000,
  exchangeRate: 60_000,
  cashBalance: 10_000,
} as const;
