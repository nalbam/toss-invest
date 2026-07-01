"use client";

import { formatDecimal, formatKrw } from "@/lib/client/format";
import { Money } from "./Money";
import { formatPrice, type OrderFormState } from "./useOrderForm";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

/**
 * Renders the 빠른주문 (quick order) flow: live price + capacities and a two-step
 * inline confirm (arm → 확정) that places a current-price LIMIT or MARKET order.
 */
export function QuickOrderForm({ form }: { form: OrderFormState }) {
  const {
    name,
    trimmedSymbol,
    currency,
    quickQuote,
    lastPrice,
    quantity,
    changeQuantity,
    stepQuantity,
    maxBuyable,
    sellableQty,
    buyingPower,
    estimated,
    estimatedKrw,
    armed,
    setArmed,
    submitting,
    submitQuick,
    armQuick,
    confirmQuick,
  } = form;

  return (
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
        확정을 누르면 현재가 지정가(LIMIT) 또는 시장가(MARKET)로 주문합니다. 서버
        안전 게이트가 최종 판정하며, DRY_RUN 모드에서는 미리보기만 실행됩니다.
      </p>
    </>
  );
}
