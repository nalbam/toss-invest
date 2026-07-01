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
  formatDecimal,
  formatKrw,
  formatUsd,
  mulDecimalStrings,
} from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import { readStoredJson, writeStoredJson } from "./localStorageJson";
import {
  getStoredItem,
  removeStoredItem,
  setStoredItem,
} from "./settingsStore";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

type OrderMode = "GENERAL" | "QUICK";
type Side = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET";
type TimeInForce = "DAY" | "CLS";
type PricingMode = "QUANTITY" | "AMOUNT";

interface OrderFormPreferences {
  mode: OrderMode;
  side: Side;
  orderType: OrderType;
  pricingMode: PricingMode;
}

interface SubmitError {
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

function writeOrderFormPreferences(prefs: OrderFormPreferences): void {
  writeStoredJson(ORDER_FORM_PREFERENCES_KEY, prefs);
}

// Per-symbol last order quantity / amount, so reselecting a symbol restores what
// the user last entered for it. Plain strings (not JSON) keyed by symbol.
const ORDER_QUANTITY_KEY_PREFIX = "toss-invest:order-quantity:";
const ORDER_AMOUNT_KEY_PREFIX = "toss-invest:order-amount:";

/** How long the "전송됨" confirmation stays visible before auto-dismissing. */
const SENT_RESULT_TIMEOUT_MS = 3000;

function readStoredField(prefix: string, symbol: string): string {
  if (symbol === "") {
    return "";
  }
  try {
    const value = getStoredItem(prefix + symbol);
    return value !== null && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0
      ? value
      : "";
  } catch {
    return "";
  }
}

function writeStoredField(prefix: string, symbol: string, value: string): void {
  if (symbol === "") {
    return;
  }
  const key = prefix + symbol;
  const trimmed = value.trim();
  try {
    if (trimmed === "") {
      removeStoredItem(key);
    } else {
      setStoredItem(key, trimmed);
    }
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

/** Formats a price/amount in the given trading currency. */
function formatPrice(
  value: string | null | undefined,
  currency: string,
): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/**
 * Order entry form with two tabs. **빠른주문 (quick order)** is the default: it
 * shows the live price + currency, the account's buying power, the max buyable
 * and sellable quantities, and lets the user fill the quantity in one tap, then
 * place a current-price LIMIT order via a two-step inline confirm (arm → 확정),
 * mirroring the cancel flow in `OrdersTable`. **일반주문 (general order)** keeps
 * the explicit confirm-checkbox + 미리보기/주문 flow.
 *
 * Every real order goes through the server's §6 safety gate, which is the source
 * of truth: `confirm:true` is only sent on the user's explicit second click and
 * is never forced. With `DRY_RUN=true` (the default) even a confirmed order comes
 * back as a DRY_RUN preview. The result is rendered per status
 * (DRY_RUN / SENT / BLOCKED) and any `{ error }` envelope surfaces as code +
 * message.
 */
export function OrderForm({
  accountSeq,
  symbol: selectedSymbol,
  name,
  cash,
  fxRate,
  prefill,
}: {
  accountSeq: number | undefined;
  symbol?: string;
  name?: string;
  cash?: { krw?: string; usd?: string };
  fxRate?: string;
  /**
   * Side + quantity proposed by the AI advisor ("폼에 담기"). Fills the inputs
   * only — it never arms a quick order or checks the confirm box, so the user
   * still reviews and passes the §6 gate (§6.A-2). A fresh object per selection.
   */
  prefill?: { side: Side; quantity: number };
}) {
  const [mode, setMode] = useState<OrderMode>("QUICK");
  const [symbol, setSymbol] = useState(selectedSymbol ?? "");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const timeInForce: TimeInForce = "DAY";
  const [pricingMode, setPricingMode] = useState<PricingMode>("QUANTITY");
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

  useEffect(() => {
    const stored = readStoredJson(
      ORDER_FORM_PREFERENCES_KEY,
      isOrderFormPreferences,
    );
    if (stored === null) {
      return;
    }
    setMode(stored.mode);
    setSide(stored.side);
    setOrderType(stored.orderType);
    setPricingMode(stored.pricingMode);
  }, []);

  const trimmedSymbol = symbol.trim();
  const quickActive = mode === "QUICK" && trimmedSymbol.length > 0;
  const quickQuote = usePrices(quickActive ? [trimmedSymbol] : []);
  const sellable = useSellableQuantity(
    accountSeq,
    quickActive ? trimmedSymbol : undefined,
  );

  const currentQuote = quickQuote.data?.[0];
  const lastPrice = currentQuote?.lastPrice;
  // Currency drives KRW vs USD everywhere. Fall back to the symbol shape (6-digit
  // = KRW) so buying power can show before the price arrives.
  const currency =
    currentQuote?.currency ?? (/^\d{6}$/.test(trimmedSymbol) ? "KRW" : "USD");
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
  // still edit it freely afterwards. A new symbol also disarms any pending
  // quick-order confirmation so a stale price can never be confirmed.
  useEffect(() => {
    if (selectedSymbol) {
      setSymbol(selectedSymbol);
      // Restore the quantity/amount last entered for this symbol (empty if none).
      setQuantity(readStoredField(ORDER_QUANTITY_KEY_PREFIX, selectedSymbol));
      setOrderAmount(readStoredField(ORDER_AMOUNT_KEY_PREFIX, selectedSymbol));
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

  // Auto-dismiss the "전송됨" confirmation so it doesn't linger. Only the SENT
  // status clears itself; DRY_RUN/BLOCKED/errors stay until the next action.
  useEffect(() => {
    if (result?.status !== "SENT") return;
    const timer = setTimeout(() => setResult(null), SENT_RESULT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [result]);

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

  return (
    <CollapsibleCard title="주문하기" storageId="order-form">
      <div className={styles.orderTabs} role="tablist" aria-label="주문 방식">
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          aria-selected={mode === "QUICK"}
          onClick={() => changeMode("QUICK")}
        >
          빠른주문
        </button>
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          aria-selected={mode === "GENERAL"}
          onClick={() => changeMode("GENERAL")}
        >
          일반주문
        </button>
        <button type="button" className={styles.orderTab} disabled>
          조건주문
        </button>
      </div>

      <form className={styles.orderForm} onSubmit={handleSubmit}>
        {mode === "GENERAL" ? (
          <>
            <div className={styles.formRow}>
              <label htmlFor="order-symbol" className={page.controlLabel}>
                종목코드
              </label>
              <input
                id="order-symbol"
                className={page.select}
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                placeholder="예: 005930 / AAPL"
              />
            </div>

            <div className={styles.orderSideTabs} aria-label="매매 구분">
              <button
                type="button"
                className={styles.orderBuyTab}
                aria-pressed={side === "BUY"}
                onClick={() => changeSide("BUY")}
              >
                구매
              </button>
              <button
                type="button"
                className={styles.orderSellTab}
                aria-pressed={side === "SELL"}
                onClick={() => changeSide("SELL")}
              >
                판매
              </button>
              <button type="button" className={styles.orderWaitTab} disabled>
                대기
              </button>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="order-type" className={page.controlLabel}>
                주문 유형
              </label>
              <select
                id="order-type"
                className={page.select}
                value={orderType}
                onChange={(event) =>
                  handleOrderTypeChange(event.target.value as OrderType)
                }
              >
                <option value="LIMIT">지정가 (LIMIT)</option>
                <option value="MARKET">시장가 (MARKET)</option>
              </select>
            </div>

            {orderType === "MARKET" ? (
              <div className={styles.formRow}>
                <span className={page.controlLabel}>주문 방식</span>
                <button
                  type="button"
                  className={page.select}
                  aria-pressed={pricingMode === "QUANTITY"}
                  onClick={() => changePricingMode("QUANTITY")}
                >
                  수량
                </button>
                <button
                  type="button"
                  className={page.select}
                  aria-pressed={pricingMode === "AMOUNT"}
                  onClick={() => changePricingMode("AMOUNT")}
                >
                  금액 (US)
                </button>
              </div>
            ) : null}

            <div className={styles.priceModeTabs} aria-label="가격 방식">
              <button
                type="button"
                className={page.select}
                aria-pressed={orderType === "LIMIT"}
                onClick={() => handleOrderTypeChange("LIMIT")}
              >
                지정가
              </button>
              <button
                type="button"
                className={page.select}
                aria-pressed={orderType === "MARKET"}
                onClick={() => handleOrderTypeChange("MARKET")}
              >
                시장가
              </button>
            </div>

            <div className={styles.formRow}>
              {amountMode ? (
                <>
                  <label htmlFor="order-amount" className={page.controlLabel}>
                    주문금액
                  </label>
                  <input
                    id="order-amount"
                    className={page.select}
                    value={orderAmount}
                    onChange={(event) => changeOrderAmount(event.target.value)}
                    placeholder="예: 1000"
                    inputMode="decimal"
                  />
                </>
              ) : (
                <>
                  <label htmlFor="order-quantity" className={page.controlLabel}>
                    수량
                  </label>
                  <div className={styles.stepperInput}>
                    <input
                      id="order-quantity"
                      className={page.select}
                      value={quantity}
                      onChange={(event) => changeQuantity(event.target.value)}
                      placeholder="최대 수량 입력"
                      inputMode="numeric"
                    />
                    <button type="button" onClick={() => stepQuantity(-1)}>
                      -
                    </button>
                    <button type="button" onClick={() => stepQuantity(1)}>
                      +
                    </button>
                  </div>
                  {showPrice ? (
                    <>
                      <label htmlFor="order-price" className={page.controlLabel}>
                        구매 가격
                      </label>
                      <div className={styles.stepperInput}>
                        <input
                          id="order-price"
                          className={page.select}
                          value={price}
                          onChange={(event) => setPrice(event.target.value)}
                          placeholder="예: 71000"
                          inputMode="decimal"
                        />
                        <span>{currentQuote?.currency ?? ""}</span>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className={styles.quickPresets} aria-label="주문 비율">
              {["10%", "25%", "50%", "최대"].map((label) => (
                <button key={label} type="button" disabled>
                  {label}
                </button>
              ))}
            </div>

            <div className={styles.orderInfoPanel}>
              <span>
                <span className={styles.metricLabel}>내 주식 평단가</span>
                <strong>-</strong>
              </span>
              <span>
                <span className={styles.metricLabel}>구매 후 예상 평단가</span>
                <strong>-</strong>
              </span>
              <span>
                <span className={styles.metricLabel}>현재 수익</span>
                <strong>-</strong>
              </span>
            </div>

            <div className={styles.formRow}>
              <label className={styles.confirmLabel} htmlFor="order-confirm">
                <input
                  id="order-confirm"
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                />
                실주문 확인 (confirm)
              </label>
              <button
                type="submit"
                name="order-side"
                value={side}
                className={`${styles.orderSubmit} ${
                  side === "BUY" ? styles.buySubmit : styles.sellSubmit
                }`}
                disabled={submitting}
              >
                {submitting
                  ? "전송 중…"
                  : confirm
                    ? side === "BUY"
                      ? "구매하기"
                      : "판매하기"
                    : "미리보기"}
              </button>
            </div>

            {!confirm ? (
              <p className={styles.confirmHint}>
                확인을 체크하지 않으면 dry-run 미리보기만 실행됩니다.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.quickHeader}>
              <div className={styles.quickHeaderTitle}>
                <span className={styles.symbolName}>
                  {name ?? (trimmedSymbol || "-")}
                </span>
                {name ? (
                  <span className={styles.symbolTicker}>{trimmedSymbol}</span>
                ) : null}
              </div>
              <div className={styles.quickHeaderPrice}>
                <span className={styles.currencyBadge}>
                  {currency === "USD" ? "USD $" : "KRW ₩"}
                </span>
                <strong>
                  {quickQuote.isLoading ? (
                    "불러오는 중…"
                  ) : lastPrice !== undefined ? (
                    <Money value={formatPrice(lastPrice, currency)} />
                  ) : (
                    "-"
                  )}
                </strong>
              </div>
            </div>

            <div className={styles.quickOrderBox}>
              <label
                htmlFor="quick-order-quantity"
                className={styles.quickInputLabel}
              >
                몇 주 주문할까요?
              </label>
              <div className={styles.stepperInput}>
                <input
                  id="quick-order-quantity"
                  className={page.select}
                  value={quantity}
                  onChange={(event) => changeQuantity(event.target.value)}
                  placeholder="수량"
                  inputMode="numeric"
                />
                <span>주</span>
                <button type="button" onClick={() => stepQuantity(-1)}>
                  -
                </button>
                <button type="button" onClick={() => stepQuantity(1)}>
                  +
                </button>
              </div>
            </div>

            <div className={styles.quickCapacityRow} aria-label="주문가능 수량">
              <button
                type="button"
                className={styles.quickCapacityChip}
                onClick={() => maxBuyable && changeQuantity(maxBuyable)}
                disabled={!maxBuyable || maxBuyable === "0"}
              >
                <span className={styles.metricLabel}>구매가능</span>
                <strong data-private-value="true">
                  {maxBuyable !== null ? `${formatDecimal(maxBuyable)}주` : "-"}
                </strong>
              </button>
              <button
                type="button"
                className={styles.quickCapacityChip}
                onClick={() => sellableQty && changeQuantity(sellableQty)}
                disabled={!sellableQty || Number(sellableQty) <= 0}
              >
                <span className={styles.metricLabel}>판매가능</span>
                <strong data-private-value="true">
                  {sellableQty !== undefined
                    ? `${formatDecimal(sellableQty, { maxFractionDigits: 4 })}주`
                    : "-"}
                </strong>
              </button>
            </div>

            <div className={styles.quickBalances}>
              <span>
                <span className={styles.metricLabel}>주문가능금액</span>
                <strong data-private-value="true">
                  <Money value={formatPrice(buyingPower, currency)} />
                </strong>
              </span>
              <span>
                <span className={styles.metricLabel}>예상 체결금액</span>
                <strong>
                  <Money
                    value={estimated !== null ? formatPrice(estimated, currency) : "-"}
                  />
                  {estimatedKrw !== null ? (
                    <span className={styles.metricSecondary}>
                      {" "}
                      ≈ <Money value={formatKrw(estimatedKrw)} />
                    </span>
                  ) : null}
                </strong>
              </span>
            </div>

            {armed === null ? (
              <div className={styles.quickActionStack}>
                <div className={styles.quickActionGrid}>
                  <button
                    type="button"
                    className={styles.quickSell}
                    onClick={(event) =>
                      event.ctrlKey || event.metaKey
                        ? submitQuick("SELL", false)
                        : armQuick("SELL", false)
                    }
                    disabled={submitting || lastPrice === undefined}
                  >
                    현재가 판매
                    {estimated !== null ? (
                      <span className={styles.quickBtnAmount}>
                        <Money value={formatPrice(estimated, currency)} />
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={styles.quickBuy}
                    onClick={(event) =>
                      event.ctrlKey || event.metaKey
                        ? submitQuick("BUY", false)
                        : armQuick("BUY", false)
                    }
                    disabled={submitting || lastPrice === undefined}
                  >
                    현재가 구매
                    {estimated !== null ? (
                      <span className={styles.quickBtnAmount}>
                        <Money value={formatPrice(estimated, currency)} />
                      </span>
                    ) : null}
                  </button>
                </div>
                <div className={styles.quickActionGrid}>
                  <button
                    type="button"
                    className={styles.quickSell}
                    onClick={(event) =>
                      event.ctrlKey || event.metaKey
                        ? submitQuick("SELL", true)
                        : armQuick("SELL", true)
                    }
                    disabled={submitting}
                  >
                    시장가 판매
                  </button>
                  <button
                    type="button"
                    className={styles.quickBuy}
                    onClick={(event) =>
                      event.ctrlKey || event.metaKey
                        ? submitQuick("BUY", true)
                        : armQuick("BUY", true)
                    }
                    disabled={submitting}
                  >
                    시장가 구매
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.quickConfirm} role="alert">
                <p className={styles.quickConfirmText}>
                  정말 {armed.market ? "시장가로 " : ""}
                  {armed.side === "BUY" ? "구매" : "판매"}하시겠어요?{" "}
                  <span data-private-value="true">{quantity.trim()}주</span>
                  {armed.market ? null : (
                    <>
                      {" "}·{" "}
                      <span data-private-value="true">
                        <Money
                          value={
                            estimated !== null
                              ? formatPrice(estimated, currency)
                              : "-"
                          }
                        />
                      </span>
                    </>
                  )}
                </p>
                <div className={styles.quickActionGrid}>
                  <button
                    type="button"
                    className={
                      armed.side === "BUY" ? styles.quickBuy : styles.quickSell
                    }
                    onClick={confirmQuick}
                    disabled={submitting}
                  >
                    {submitting
                      ? "전송 중…"
                      : `${armed.market ? "시장가 " : ""}${
                          armed.side === "BUY" ? "구매" : "판매"
                        } 확정`}
                  </button>
                  <button
                    type="button"
                    className={styles.quickCancel}
                    onClick={() => setArmed(null)}
                    disabled={submitting}
                  >
                    되돌리기
                  </button>
                </div>
              </div>
            )}

            <p className={styles.confirmHint}>
              확정을 누르면 현재가 지정가(LIMIT) 또는 시장가(MARKET)로 주문합니다.
              서버 안전 게이트가 최종 판정하며, DRY_RUN 모드에서는 미리보기만
              실행됩니다.
            </p>
          </>
        )}
      </form>

      <OrderResult result={result} error={error} />
    </CollapsibleCard>
  );
}

/** Renders the order outcome per status, or the error envelope. */
function OrderResult({
  result,
  error,
}: {
  result: OrderPlaceResult | null;
  error: SubmitError | null;
}) {
  if (error) {
    return (
      <div className={`${styles.orderResult} ${styles.negative}`} role="alert">
        <p className={styles.resultTitle}>오류</p>
        <p>
          [{error.code}] {error.message}
        </p>
      </div>
    );
  }

  if (!result) {
    return null;
  }

  if (result.status === "DRY_RUN") {
    return (
      <div className={styles.orderResult} role="status">
        <p className={styles.resultTitle}>🔍 미리보기 (전송되지 않음)</p>
        <WouldSend body={result.wouldSend} />
        <PrevalidationView
          available={result.prevalidation.available}
          requested={result.prevalidation.requested}
          insufficient={result.prevalidation.insufficient}
        />
        <ReasonList reasons={result.reasons} label="사유" />
      </div>
    );
  }

  if (result.status === "BLOCKED") {
    return (
      <div className={`${styles.orderResult} ${styles.negative}`} role="alert">
        <p className={styles.resultTitle}>⛔ 차단됨</p>
        <ReasonList reasons={result.reasons} label="차단 사유" />
      </div>
    );
  }

  // SENT
  return (
    <div className={`${styles.orderResult} ${styles.positive}`} role="status">
      <p className={styles.resultTitle}>✅ 전송됨</p>
      <p>주문이 정상적으로 전송되었습니다.</p>
    </div>
  );
}

/** Summarizes the would-be request shown in a DRY_RUN preview. */
function WouldSend({ body }: { body: OrderCreateBody }) {
  return (
    <dl className={styles.wouldSend}>
      <div>
        <dt>종목</dt>
        <dd>{body.symbol}</dd>
      </div>
      <div>
        <dt>구분</dt>
        <dd>{body.side}</dd>
      </div>
      <div>
        <dt>유형</dt>
        <dd>{body.orderType}</dd>
      </div>
      {body.quantity !== undefined ? (
        <div>
          <dt>수량</dt>
          <dd data-private-value="true">{body.quantity}</dd>
        </div>
      ) : null}
      {body.price !== undefined ? (
        <div>
          <dt>가격</dt>
          <dd data-private-value="true">{body.price}</dd>
        </div>
      ) : null}
      {body.orderAmount !== undefined ? (
        <div>
          <dt>주문금액</dt>
          <dd data-private-value="true">{body.orderAmount}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Renders the advisory prevalidation (available vs. requested). */
function PrevalidationView({
  available,
  requested,
  insufficient,
}: {
  available: string | null;
  requested: string | null;
  insufficient: boolean;
}) {
  return (
    <p className={styles.prevalidation}>
      사전검증 — 가용:{" "}
      <span data-private-value="true">{available ?? "확인 불가"}</span> / 요청:{" "}
      <span data-private-value="true">{requested ?? "-"}</span>
      {insufficient ? " (부족 가능성)" : ""}
    </p>
  );
}

/** Lists the gate reasons attached to a DRY_RUN or BLOCKED result. */
function ReasonList({ reasons, label }: { reasons: string[]; label: string }) {
  if (reasons.length === 0) {
    return null;
  }
  return (
    <div className={styles.reasons}>
      <p className={styles.reasonsLabel}>{label}</p>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}
