"use client";

import { useEffect, useState } from "react";
import {
  ApiClientError,
  submitOrder,
  usePrices,
  useSellableQuantity,
} from "@/lib/client/hooks";
import type { OrderCreateBody, OrderPlaceResult } from "@/lib/client/types";
import {
  floorDivToInteger,
  formatKrw,
  formatUsd,
  mulDecimalStrings,
} from "@/lib/client/format";
import { readStoredJson, writeStoredJson } from "./localStorageJson";

export type OrderMode = "GENERAL" | "QUICK";
export type Side = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
type TimeInForce = "DAY" | "CLS";
export type PricingMode = "QUANTITY" | "AMOUNT";

interface OrderFormPreferences {
  mode: OrderMode;
  side: Side;
  orderType: OrderType;
  pricingMode: PricingMode;
}

export interface SubmitError {
  code: string;
  message: string;
}

const ORDER_FORM_PREFERENCES_KEY = "toss-invest:order-form-preferences";

function isOrderMode(value: unknown): value is OrderMode {
  return value === "GENERAL" || value === "QUICK";
}

function isSide(value: unknown): value is Side {
  return value === "BUY" || value === "SELL";
}

function isOrderType(value: unknown): value is OrderType {
  return value === "LIMIT" || value === "MARKET";
}

function isPricingMode(value: unknown): value is PricingMode {
  return value === "QUANTITY" || value === "AMOUNT";
}

function isOrderFormPreferences(value: unknown): value is OrderFormPreferences {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prefs = value as Partial<OrderFormPreferences>;
  return (
    isOrderMode(prefs.mode) &&
    isSide(prefs.side) &&
    isOrderType(prefs.orderType) &&
    isPricingMode(prefs.pricingMode) &&
    (prefs.orderType === "MARKET" || prefs.pricingMode === "QUANTITY")
  );
}

function readOrderFormPreferences(): OrderFormPreferences | null {
  return readStoredJson(ORDER_FORM_PREFERENCES_KEY, isOrderFormPreferences);
}

function writeOrderFormPreferences(prefs: OrderFormPreferences): void {
  writeStoredJson(ORDER_FORM_PREFERENCES_KEY, prefs);
}

// Per-symbol last order quantity / amount, so reselecting a symbol restores what
// the user last entered for it. Kept client-only in sessionStorage (not synced to
// the server) so per-symbol drafts never accumulate rows server-side; they still
// survive an in-session reload. Plain strings (not JSON) keyed by symbol.
const ORDER_QUANTITY_KEY_PREFIX = "toss-invest:order-quantity:";
const ORDER_AMOUNT_KEY_PREFIX = "toss-invest:order-amount:";

/** How long an order outcome (전송됨/차단됨/오류) stays visible before auto-dismissing. */
const ORDER_RESULT_TIMEOUT_MS = 3000;

function readStoredField(prefix: string, symbol: string): string {
  if (symbol === "" || typeof window === "undefined") {
    return "";
  }
  try {
    const value = window.sessionStorage.getItem(prefix + symbol);
    return value !== null && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0
      ? value
      : "";
  } catch {
    return "";
  }
}

function writeStoredField(prefix: string, symbol: string, value: string): void {
  if (symbol === "" || typeof window === "undefined") {
    return;
  }
  const key = prefix + symbol;
  const trimmed = value.trim();
  try {
    if (trimmed === "") {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, trimmed);
    }
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

/** Formats a price/amount in the given trading currency. */
export function formatPrice(
  value: string | null | undefined,
  currency: string,
): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

export interface UseOrderFormArgs {
  accountSeq: number | undefined;
  symbol?: string;
  name?: string;
  cash?: { krw?: string; usd?: string };
  fxRate?: string;
  prefill?: { side: Side; quantity: number };
}

/**
 * Encapsulates all OrderForm state, persisted preferences/drafts, derived quote
 * values, and the general + quick submit handlers. Both `GeneralOrderForm` and
 * `QuickOrderForm` render against the object this returns, so the two flows share
 * one source of truth without changing any behavior.
 */
export function useOrderForm({
  accountSeq,
  symbol: selectedSymbol,
  name,
  cash,
  fxRate,
  prefill,
}: UseOrderFormArgs) {
  const [mode, setMode] = useState<OrderMode>(
    () => readOrderFormPreferences()?.mode ?? "QUICK",
  );
  const [symbol, setSymbol] = useState(selectedSymbol ?? "");
  const [side, setSide] = useState<Side>(
    () => readOrderFormPreferences()?.side ?? "BUY",
  );
  const [orderType, setOrderType] = useState<OrderType>(
    () => readOrderFormPreferences()?.orderType ?? "LIMIT",
  );
  const timeInForce: TimeInForce = "DAY";
  const [pricingMode, setPricingMode] = useState<PricingMode>(
    () => readOrderFormPreferences()?.pricingMode ?? "QUANTITY",
  );
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [confirm, setConfirm] = useState(false);
  // Quick-order two-step confirm: the side + order type (시장가 vs 현재가) armed
  // and awaiting the explicit 확정 click, or null when no order is armed.
  const [armed, setArmed] = useState<{ side: Side; market: boolean } | null>(
    null,
  );

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderPlaceResult | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);

  const trimmedSymbol = symbol.trim();
  const quickActive = mode === "QUICK" && trimmedSymbol.length > 0;
  const quickQuote = usePrices(quickActive ? [trimmedSymbol] : []);
  const sellable = useSellableQuantity(
    accountSeq,
    quickActive ? trimmedSymbol : undefined,
  );

  const currentQuote = quickQuote.data?.[0];
  const lastPrice = currentQuote?.lastPrice;
  // Currency drives KRW vs USD everywhere. Before the price arrives, fall back to
  // the symbol shape: a digit-led 6-char KRX code = KRW (same predicate as the
  // server's isKrwSymbol, so letter-embedded ETF codes like 0167A0 aren't
  // misread as USD), otherwise USD. The server re-derives currency, display-only.
  const currency =
    currentQuote?.currency ??
    (/^\d[0-9A-Z]{5}$/.test(trimmedSymbol) ? "KRW" : "USD");
  const buyingPower = currency === "USD" ? cash?.usd : cash?.krw;
  const maxBuyable =
    buyingPower !== undefined && lastPrice !== undefined
      ? floorDivToInteger(buyingPower, lastPrice)
      : null;
  const sellableQty = sellable.data?.sellableQuantity;
  const hasQuantity = quantity.trim().length > 0 && Number(quantity) > 0;
  const estimated =
    lastPrice !== undefined && hasQuantity
      ? mulDecimalStrings(lastPrice, quantity.trim())
      : null;
  const estimatedKrw =
    currency === "USD" && fxRate && estimated
      ? mulDecimalStrings(estimated, fxRate)
      : null;

  // Prefill the symbol from the dashboard selection. Selecting a new holding
  // overwrites the field so the form follows the chosen symbol; the user can
  // still edit it freely afterwards. Switching symbols also clears the LIMIT
  // price, the live-order confirm, and any armed quick order so a stale price or
  // confirm from the previous symbol can never be submitted for the new one.
  useEffect(() => {
    if (selectedSymbol) {
      setSymbol(selectedSymbol);
      // Restore the quantity/amount last entered for this symbol (empty if none).
      setQuantity(readStoredField(ORDER_QUANTITY_KEY_PREFIX, selectedSymbol));
      setOrderAmount(readStoredField(ORDER_AMOUNT_KEY_PREFIX, selectedSymbol));
      setPrice("");
      setConfirm(false);
      setArmed(null);
    }
  }, [selectedSymbol]);

  // Apply an advisor proposal selected via "폼에 담기": fill the side + quantity
  // only. It never arms a quick order or checks the confirm box, so a prefilled
  // order can never be sent without the user's explicit confirm + the §6 gate
  // (§6.A-2). A new prefill object per selection re-applies the values.
  useEffect(() => {
    if (!prefill) return;
    setSide(prefill.side);
    setQuantity(String(prefill.quantity));
    setPricingMode("QUANTITY");
    setArmed(null);
    setConfirm(false);
  }, [prefill]);

  // Auto-dismiss order outcomes (전송됨/차단됨/오류) so they don't linger. The
  // DRY_RUN preview stays until the next action since the user reads it to decide.
  useEffect(() => {
    const isOutcome =
      error !== null ||
      result?.status === "SENT" ||
      result?.status === "BLOCKED";
    if (!isOutcome) return;
    const timer = setTimeout(() => {
      setResult(null);
      setError(null);
    }, ORDER_RESULT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [result, error]);

  // Amount-based ordering is US MARKET only; LIMIT always uses quantity.
  const amountMode = pricingMode === "AMOUNT" && orderType === "MARKET";
  const showPrice = orderType === "LIMIT";

  function updatePreferences(next: Partial<OrderFormPreferences>) {
    writeOrderFormPreferences({
      mode,
      side,
      orderType,
      pricingMode,
      ...next,
    });
  }

  function changeMode(next: OrderMode) {
    setMode(next);
    updatePreferences({ mode: next });
  }

  function changeSide(next: Side) {
    setSide(next);
    updatePreferences({ side: next });
  }

  function changePricingMode(next: PricingMode) {
    setPricingMode(next);
    updatePreferences({ pricingMode: next });
  }

  function handleOrderTypeChange(next: OrderType) {
    setOrderType(next);
    // LIMIT cannot be amount-based; drop back to quantity pricing.
    if (next === "LIMIT") {
      setPricingMode("QUANTITY");
      updatePreferences({ orderType: next, pricingMode: "QUANTITY" });
      return;
    }
    updatePreferences({ orderType: next });
  }

  /**
   * Sets the quantity, persists it per-symbol (so reselecting the symbol restores
   * it), and disarms any pending quick-order confirmation.
   */
  function changeQuantity(next: string) {
    setQuantity(next);
    setArmed(null);
    writeStoredField(ORDER_QUANTITY_KEY_PREFIX, trimmedSymbol, next);
  }

  /** Sets the order amount and persists it per-symbol. */
  function changeOrderAmount(next: string) {
    setOrderAmount(next);
    writeStoredField(ORDER_AMOUNT_KEY_PREFIX, trimmedSymbol, next);
  }

  function stepQuantity(delta: number) {
    const current = Number(quantity || "0");
    const next = Math.max(0, Math.floor(current + delta));
    changeQuantity(next === 0 ? "" : String(next));
  }

  function buildGeneralBody(
    submitSide: Side,
  ): OrderCreateBody | { error: string } {
    const base = {
      symbol: trimmedSymbol,
      side: submitSide,
      orderType,
      confirm,
    };
    if (amountMode) {
      if (orderAmount.trim().length === 0) {
        return { error: "주문금액을 입력하세요." };
      }
      return { ...base, orderType: "MARKET", orderAmount: orderAmount.trim() };
    }
    if (quantity.trim().length === 0) {
      return { error: "수량을 입력하세요." };
    }
    if (orderType === "LIMIT" && price.trim().length === 0) {
      return { error: "LIMIT 주문은 가격을 입력하세요." };
    }
    const body: OrderCreateBody = {
      ...base,
      timeInForce,
      quantity: quantity.trim(),
    };
    if (orderType === "LIMIT") {
      body.price = price.trim();
    }
    return body;
  }

  /** Sends an order body and renders its outcome / error. */
  async function send(body: OrderCreateBody) {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const placed = await submitOrder(accountSeq, body);
      setResult(placed);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: "unexpected-error",
          message: "주문 요청에 실패했습니다.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // General order: confirm comes from the checkbox (DRY_RUN preview when off).
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "QUICK") {
      // Quick order is driven by its own buttons (armQuick/confirmQuick); never
      // submit it through the form (e.g. an Enter keypress in the qty field).
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const submitSide =
      submitter instanceof HTMLButtonElement &&
      (submitter.value === "BUY" || submitter.value === "SELL")
        ? submitter.value
        : side;
    changeSide(submitSide);
    if (trimmedSymbol.length === 0) {
      setResult(null);
      setError({ code: "invalid-input", message: "종목코드를 입력하세요." });
      return;
    }
    const built = buildGeneralBody(submitSide);
    if ("error" in built) {
      setResult(null);
      setError({ code: "invalid-input", message: built.error });
      return;
    }
    await send(built);
  }

  /** Arms the quick-order confirmation for a side (no order is sent yet). */
  function armQuick(armSide: Side, market: boolean) {
    if (!hasQuantity) {
      setResult(null);
      setError({ code: "invalid-input", message: "수량을 입력하세요." });
      return;
    }
    if (!market && lastPrice === undefined) {
      setResult(null);
      setError({ code: "no-price", message: "현재가를 불러오지 못했습니다." });
      return;
    }
    setError(null);
    setResult(null);
    changeSide(armSide);
    setArmed({ side: armSide, market });
  }

  // Sends a quick order for `quickSide` with confirm:true. `market` chooses a
  // MARKET order (no price; the server values it via the current price) over a
  // current-price LIMIT order. Shared by the two-step confirm (confirmQuick) and
  // the modifier+click shortcut. The §6 gate still decides SEND vs DRY_RUN.
  async function submitQuick(quickSide: Side, market: boolean) {
    if (submitting) {
      return;
    }
    if (!hasQuantity) {
      setResult(null);
      setError({ code: "invalid-input", message: "수량을 입력하세요." });
      return;
    }
    let body: OrderCreateBody;
    if (market) {
      body = {
        symbol: trimmedSymbol,
        side: quickSide,
        orderType: "MARKET",
        timeInForce: "DAY",
        quantity: quantity.trim(),
        confirm: true,
      };
    } else {
      if (lastPrice === undefined) {
        setResult(null);
        setError({ code: "no-price", message: "현재가를 불러오지 못했습니다." });
        return;
      }
      body = {
        symbol: trimmedSymbol,
        side: quickSide,
        orderType: "LIMIT",
        timeInForce: "DAY",
        quantity: quantity.trim(),
        price: lastPrice,
        confirm: true,
      };
    }
    await send(body);
    setArmed(null);
  }

  // Quick order: the explicit second click of the two-step confirm.
  async function confirmQuick() {
    if (armed === null) {
      return;
    }
    await submitQuick(armed.side, armed.market);
  }

  return {
    name,
    mode,
    changeMode,
    symbol,
    setSymbol,
    trimmedSymbol,
    side,
    changeSide,
    orderType,
    handleOrderTypeChange,
    pricingMode,
    changePricingMode,
    amountMode,
    showPrice,
    quantity,
    changeQuantity,
    stepQuantity,
    price,
    setPrice,
    orderAmount,
    changeOrderAmount,
    confirm,
    setConfirm,
    armed,
    setArmed,
    submitting,
    result,
    error,
    currentQuote,
    quickQuote,
    lastPrice,
    currency,
    buyingPower,
    maxBuyable,
    sellableQty,
    estimated,
    estimatedKrw,
    handleSubmit,
    armQuick,
    submitQuick,
    confirmQuick,
  };
}

export type OrderFormState = ReturnType<typeof useOrderForm>;
