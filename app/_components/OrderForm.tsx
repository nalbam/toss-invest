"use client";

import { useState } from "react";
import { ApiClientError, submitOrder } from "@/lib/client/hooks";
import type { OrderCreateBody, OrderPlaceResult } from "@/lib/client/types";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

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
export function OrderForm({ accountSeq }: { accountSeq: number | undefined }) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("DAY");
  const [pricingMode, setPricingMode] = useState<PricingMode>("QUANTITY");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [confirm, setConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderPlaceResult | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);

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

  function buildBody(): OrderCreateBody | { error: string } {
    const trimmedSymbol = symbol.trim();
    if (trimmedSymbol.length === 0) {
      return { error: "종목코드를 입력하세요." };
    }
    const base = {
      symbol: trimmedSymbol,
      side,
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const built = buildBody();
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
    <section className={styles.card} aria-label="주문하기">
      <h2 className={styles.cardTitle}>주문하기</h2>

      <form className={styles.orderForm} onSubmit={handleSubmit}>
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

        <div className={styles.formRow}>
          <label htmlFor="order-side" className={page.controlLabel}>
            구분
          </label>
          <select
            id="order-side"
            className={page.select}
            value={side}
            onChange={(event) => setSide(event.target.value as Side)}
          >
            <option value="BUY">매수 (BUY)</option>
            <option value="SELL">매도 (SELL)</option>
          </select>

          <label htmlFor="order-type" className={page.controlLabel}>
            유형
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

          <label htmlFor="order-tif" className={page.controlLabel}>
            유효기간
          </label>
          <select
            id="order-tif"
            className={page.select}
            value={timeInForce}
            onChange={(event) =>
              setTimeInForce(event.target.value as TimeInForce)
            }
            disabled={amountMode}
          >
            <option value="DAY">당일 (DAY)</option>
            <option value="CLS">종가 (CLS)</option>
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
              <input
                id="order-quantity"
                className={page.select}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="예: 10"
                inputMode="numeric"
              />
              {showPrice ? (
                <>
                  <label htmlFor="order-price" className={page.controlLabel}>
                    가격
                  </label>
                  <input
                    id="order-price"
                    className={page.select}
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="예: 71000"
                    inputMode="decimal"
                  />
                </>
              ) : null}
            </>
          )}
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
          <button type="submit" className={page.select} disabled={submitting}>
            {submitting ? "전송 중…" : confirm ? "주문 전송" : "미리보기"}
          </button>
        </div>

        {!confirm ? (
          <p className={styles.confirmHint}>
            확인을 체크하지 않으면 dry-run 미리보기만 실행됩니다.
          </p>
        ) : null}
      </form>

      <OrderResult result={result} error={error} />
    </section>
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
