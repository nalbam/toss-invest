"use client";

import { useEffect, useState } from "react";
import { ApiClientError, submitOrder, usePrices } from "@/lib/client/hooks";
import type { OrderCreateBody, OrderPlaceResult } from "@/lib/client/types";
import { formatKrw, formatUsd } from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

type OrderMode = "GENERAL" | "QUICK";
type Side = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET";
type TimeInForce = "DAY" | "CLS";
type PricingMode = "QUANTITY" | "AMOUNT";

interface SubmitError {
  code: string;
  message: string;
}

/**
 * Order entry form. Submits to `POST /api/orders` with the per-order `confirm`
 * flag taken straight from the checkbox — never forced to `true`. The server's
 * §6 safety gate makes the final call, so an unchecked confirm always comes
 * back as a DRY_RUN preview. The result is rendered per status (DRY_RUN / SENT /
 * BLOCKED) and any `{ error }` envelope surfaces as its code + message.
 */
export function OrderForm({
  accountSeq,
  symbol: selectedSymbol,
}: {
  accountSeq: number | undefined;
  symbol?: string;
}) {
  const [mode, setMode] = useState<OrderMode>("GENERAL");
  const [symbol, setSymbol] = useState(selectedSymbol ?? "");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const timeInForce: TimeInForce = "DAY";
  const [pricingMode, setPricingMode] = useState<PricingMode>("QUANTITY");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [confirm, setConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderPlaceResult | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);
  const quickQuote = usePrices(
    mode === "QUICK" && symbol.trim() ? [symbol.trim()] : [],
  );
  const currentQuote = quickQuote.data?.[0];
  const currentPriceLabel =
    currentQuote === undefined
      ? "-"
      : currentQuote.currency === "USD"
        ? formatUsd(currentQuote.lastPrice)
        : formatKrw(currentQuote.lastPrice);

  // Prefill the symbol from the dashboard selection. Selecting a new holding
  // overwrites the field so the form follows the chosen symbol; the user can
  // still edit it freely afterwards.
  useEffect(() => {
    if (selectedSymbol) {
      setSymbol(selectedSymbol);
    }
  }, [selectedSymbol]);

  // Amount-based ordering is US MARKET only; LIMIT always uses quantity.
  const amountMode = pricingMode === "AMOUNT" && orderType === "MARKET";
  const showPrice = orderType === "LIMIT";

  function handleOrderTypeChange(next: OrderType) {
    setOrderType(next);
    // LIMIT cannot be amount-based; drop back to quantity pricing.
    if (next === "LIMIT") {
      setPricingMode("QUANTITY");
    }
  }

  function setPresetQuantity(next: string) {
    setQuantity(next);
  }

  function stepQuantity(delta: number) {
    const current = Number(quantity || "0");
    const next = Math.max(0, Math.floor(current + delta));
    setQuantity(next === 0 ? "" : String(next));
  }

  function buildGeneralBody(
    trimmedSymbol: string,
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

  function buildQuickBody(
    trimmedSymbol: string,
    submitSide: Side,
  ): OrderCreateBody | { error: string } {
    if (quantity.trim().length === 0) {
      return { error: "수량을 입력하세요." };
    }
    return {
      symbol: trimmedSymbol,
      side: submitSide,
      orderType: "MARKET",
      timeInForce: "DAY",
      quantity: quantity.trim(),
      confirm,
    };
  }

  function buildBody(submitSide: Side): OrderCreateBody | { error: string } {
    const trimmedSymbol = symbol.trim();
    if (trimmedSymbol.length === 0) {
      return { error: "종목코드를 입력하세요." };
    }
    return mode === "QUICK"
      ? buildQuickBody(trimmedSymbol, submitSide)
      : buildGeneralBody(trimmedSymbol, submitSide);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const submitSide =
      submitter instanceof HTMLButtonElement &&
      (submitter.value === "BUY" || submitter.value === "SELL")
        ? submitter.value
        : side;
    setSide(submitSide);
    const built = buildBody(submitSide);
    if ("error" in built) {
      setResult(null);
      setError({ code: "invalid-input", message: built.error });
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const placed = await submitOrder(accountSeq, built);
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

  return (
    <CollapsibleCard title="주문하기" storageId="order-form">
      <div className={styles.orderTabs} role="tablist" aria-label="주문 방식">
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          aria-selected={mode === "GENERAL"}
          onClick={() => setMode("GENERAL")}
        >
          일반주문
        </button>
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          aria-selected={mode === "QUICK"}
          onClick={() => setMode("QUICK")}
        >
          빠른주문
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
                onClick={() => setSide("BUY")}
              >
                구매
              </button>
              <button
                type="button"
                className={styles.orderSellTab}
                aria-pressed={side === "SELL"}
                onClick={() => setSide("SELL")}
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
                  onClick={() => setPricingMode("QUANTITY")}
                >
                  수량
                </button>
                <button
                  type="button"
                  className={page.select}
                  aria-pressed={pricingMode === "AMOUNT"}
                  onClick={() => setPricingMode("AMOUNT")}
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
                    onChange={(event) => setOrderAmount(event.target.value)}
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
                      onChange={(event) => setQuantity(event.target.value)}
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
                        <button type="button">-</button>
                        <button type="button">+</button>
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
          </>
        ) : (
          <>
            <div className={styles.quickOrderBox}>
              <label htmlFor="quick-order-quantity" className={styles.quickInputLabel}>
                몇 주 주문할까요?
              </label>
              <div className={styles.quickQuantityInput}>
                <input
                  id="quick-order-quantity"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="수량"
                  inputMode="numeric"
                />
                <span>주</span>
                <button type="button" aria-pressed>
                  주
                </button>
                <button type="button" disabled>
                  %
                </button>
                <button type="button" onClick={() => stepQuantity(-1)}>
                  -
                </button>
                <button type="button" onClick={() => stepQuantity(1)}>
                  +
                </button>
              </div>
            </div>

            <div className={styles.quickPresets} aria-label="빠른 수량">
              <button type="button" onClick={() => setPresetQuantity("1")}>
                1주
              </button>
              <button type="button" onClick={() => setPresetQuantity("10")}>
                10주
              </button>
              <button type="button" onClick={() => setPresetQuantity("100")}>
                100주
              </button>
              <button type="button" disabled>
                최대
              </button>
            </div>

            <div className={styles.quickBalances}>
              <span>
                <span className={styles.metricLabel}>판매가능</span>
                <strong>-</strong>
              </span>
              <span>
                <span className={styles.metricLabel}>구매가능</span>
                <strong>-</strong>
              </span>
              <span>
                <span className={styles.metricLabel}>판매예상</span>
                <strong>0</strong>
              </span>
              <span>
                <span className={styles.metricLabel}>구매예상</span>
                <strong>0</strong>
              </span>
            </div>

            <div className={styles.quickQuote}>
              <span className={styles.metricLabel}>{symbol || "-"}</span>
              <strong>{quickQuote.isLoading ? "불러오는 중…" : currentPriceLabel}</strong>
            </div>

            <div className={styles.quickActionGrid}>
              <button
                type="submit"
                name="quick-side"
                value="SELL"
                className={styles.quickSell}
              >
                현재가 판매
              </button>
              <button
                type="submit"
                name="quick-side"
                value="BUY"
                className={styles.quickBuy}
              >
                현재가 구매
              </button>
              <button
                type="submit"
                name="quick-side"
                value="SELL"
                className={styles.quickSell}
              >
                시장가 판매
              </button>
              <button
                type="submit"
                name="quick-side"
                value="BUY"
                className={styles.quickBuy}
              >
                시장가 구매
              </button>
              <button type="button" className={styles.quickCancel}>
                전체 취소
              </button>
            </div>
          </>
        )}

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
          {mode === "GENERAL" ? (
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
          ) : null}
        </div>

        {!confirm ? (
          <p className={styles.confirmHint}>
            확인을 체크하지 않으면 dry-run 미리보기만 실행됩니다.
          </p>
        ) : null}
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
      <p>주문번호: {result.response.orderId}</p>
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
          <dd>{body.quantity}</dd>
        </div>
      ) : null}
      {body.price !== undefined ? (
        <div>
          <dt>가격</dt>
          <dd>{body.price}</dd>
        </div>
      ) : null}
      {body.orderAmount !== undefined ? (
        <div>
          <dt>주문금액</dt>
          <dd>{body.orderAmount}</dd>
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
      사전검증 — 가용: {available ?? "확인 불가"} / 요청: {requested ?? "-"}
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
