"use client";

import type { OrderCreateBody, OrderPlaceResult } from "@/lib/client/types";
import type { SubmitError } from "./useOrderForm";
import styles from "./dashboard.module.css";

/** Renders the order outcome per status, or the error envelope. */
export function OrderResult({
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
        <p>{error.message}</p>
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
