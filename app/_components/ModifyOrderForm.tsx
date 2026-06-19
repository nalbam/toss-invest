"use client";

import { useState } from "react";
import { ApiClientError, modifyOrder } from "@/lib/client/hooks";
import type { ModifyOrderResult, OrderModifyBody } from "@/lib/client/types";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

type OrderType = "LIMIT" | "MARKET";

interface SubmitError {
  code: string;
  message: string;
}

/**
 * Inline modify form for a single pending order. Submits to
 * `POST /api/orders/{orderId}/modify` with the per-order `confirm` flag taken
 * straight from the checkbox — never forced to `true`. The server's §6 safety
 * gate makes the final call, so an unchecked confirm always comes back as a
 * DRY_RUN preview. The result is rendered per status (DRY_RUN / SENT / BLOCKED)
 * and any `{ error }` envelope surfaces as its code + message. Reuses the same
 * confirm/result patterns as `OrderForm`. On a SENT modify it calls `onModified`
 * so the parent can refresh the order list.
 */
export function ModifyOrderForm({
  accountSeq,
  orderId,
  defaultOrderType,
  defaultQuantity,
  defaultPrice,
  onModified,
}: {
  accountSeq: number | undefined;
  orderId: string;
  defaultOrderType: OrderType;
  defaultQuantity: string;
  defaultPrice: string;
  onModified?: () => void;
}) {
  const [orderType, setOrderType] = useState<OrderType>(defaultOrderType);
  const [quantity, setQuantity] = useState(defaultQuantity);
  const [price, setPrice] = useState(defaultPrice);
  const [confirm, setConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ModifyOrderResult | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);

  const showPrice = orderType === "LIMIT";

  function buildBody(): OrderModifyBody | { error: string } {
    if (orderType === "LIMIT" && price.trim().length === 0) {
      return { error: "LIMIT 정정은 가격을 입력하세요." };
    }
    const body: OrderModifyBody = { orderType };
    if (quantity.trim().length > 0) {
      body.quantity = quantity.trim();
    }
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
      const modified = await modifyOrder(accountSeq, orderId, built, confirm);
      setResult(modified);
      if (modified.status === "SENT") {
        onModified?.();
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: "unexpected-error",
          message: "정정 요청에 실패했습니다.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.orderForm} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <label htmlFor={`modify-type-${orderId}`} className={page.controlLabel}>
          유형
        </label>
        <select
          id={`modify-type-${orderId}`}
          className={page.select}
          value={orderType}
          onChange={(event) => setOrderType(event.target.value as OrderType)}
        >
          <option value="LIMIT">지정가 (LIMIT)</option>
          <option value="MARKET">시장가 (MARKET)</option>
        </select>

        <label htmlFor={`modify-qty-${orderId}`} className={page.controlLabel}>
          수량
        </label>
        <input
          id={`modify-qty-${orderId}`}
          className={page.select}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          placeholder="예: 10"
          inputMode="numeric"
        />

        {showPrice ? (
          <>
            <label
              htmlFor={`modify-price-${orderId}`}
              className={page.controlLabel}
            >
              가격
            </label>
            <input
              id={`modify-price-${orderId}`}
              className={page.select}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="예: 71000"
              inputMode="decimal"
            />
          </>
        ) : null}
      </div>

      <div className={styles.formRow}>
        <label
          className={styles.confirmLabel}
          htmlFor={`modify-confirm-${orderId}`}
        >
          <input
            id={`modify-confirm-${orderId}`}
            type="checkbox"
            checked={confirm}
            onChange={(event) => setConfirm(event.target.checked)}
          />
          실주문 확인 (confirm)
        </label>
        <button type="submit" className={page.select} disabled={submitting}>
          {submitting ? "전송 중…" : confirm ? "정정 전송" : "미리보기"}
        </button>
      </div>

      {!confirm ? (
        <p className={styles.confirmHint}>
          확인을 체크하지 않으면 dry-run 미리보기만 실행됩니다.
        </p>
      ) : null}

      <ModifyResult result={result} error={error} />
    </form>
  );
}

/** Renders the modify outcome per status, or the error envelope. */
function ModifyResult({
  result,
  error,
}: {
  result: ModifyOrderResult | null;
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
        <ModifyWouldSend body={result.wouldSend} />
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
      <p className={styles.resultTitle}>✅ 정정 전송됨</p>
      <p>주문번호: {result.response.orderId}</p>
    </div>
  );
}

/** Summarizes the would-be modify request shown in a DRY_RUN preview. */
function ModifyWouldSend({ body }: { body: OrderModifyBody }) {
  return (
    <dl className={styles.wouldSend}>
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
    </dl>
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
