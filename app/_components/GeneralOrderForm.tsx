"use client";

import type { OrderFormState, OrderType } from "./useOrderForm";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

/** Renders the 일반주문 (general order) flow: explicit confirm-checkbox + 미리보기/주문. */
export function GeneralOrderForm({ form }: { form: OrderFormState }) {
  const {
    symbol,
    setSymbol,
    side,
    changeSide,
    orderType,
    handleOrderTypeChange,
    pricingMode,
    changePricingMode,
    amountMode,
    orderAmount,
    changeOrderAmount,
    quantity,
    changeQuantity,
    stepQuantity,
    showPrice,
    price,
    setPrice,
    currentQuote,
    confirm,
    setConfirm,
    submitting,
  } = form;

  return (
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
              <button
                type="button"
                aria-label="수량 감소"
                onClick={() => stepQuantity(-1)}
              >
                -
              </button>
              <button
                type="button"
                aria-label="수량 증가"
                onClick={() => stepQuantity(1)}
              >
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
  );
}
