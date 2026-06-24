"use client";

import { useState } from "react";
import { ApiClientError, cancelOrder } from "@/lib/client/hooks";
import type { CancelOrderResult, Order } from "@/lib/client/types";
import { formatDecimal, formatKrw, formatUsd } from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import { ModifyOrderForm } from "./ModifyOrderForm";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

/** Formats an order price in the order's own trading currency. */
function formatPrice(value: string | null, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/**
 * Renders an ISO date-time as "YYYY-MM-DD HH:mm" when parseable, otherwise the
 * raw string. Keeps display deterministic without depending on locale/timezone
 * formatting that would differ between server and client.
 */
function formatOrderedAt(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

/**
 * Pending statuses still eligible for modify/cancel. Filled/canceled/rejected
 * terminal states are excluded so the actions are only offered where they can
 * actually take effect.
 */
const CANCELABLE_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "PENDING_CANCEL",
  "PENDING_REPLACE",
  "PARTIAL_FILLED",
]);

function isCancelable(status: string): boolean {
  return CANCELABLE_STATUSES.has(status);
}

/**
 * Tabular view of orders. Each row shows the instrument, side, order type,
 * status, ordered/filled quantity, price, and order time. Pending orders also
 * expose inline modify/cancel actions. Renders an empty state when there are no
 * orders.
 *
 * `orders` carries the open (pending) orders. When a symbol is selected,
 * `completedOrders` carries that symbol's terminal orders (CLOSED:
 * FILLED/CANCELED/REJECTED/REPLACED), rendered in a separate section so
 * completed fills are distinguished from still-pending orders.
 */
export function OrdersTable({
  orders,
  completedOrders,
  accountSeq,
  selectedSymbol,
  onChanged,
  refreshing,
}: {
  orders: Order[];
  completedOrders?: Order[];
  accountSeq?: number | undefined;
  selectedSymbol?: string;
  onChanged?: () => void;
  refreshing?: boolean;
}) {
  const selectedOpenOrders =
    selectedSymbol === undefined
      ? []
      : orders.filter((order) => order.symbol === selectedSymbol);
  const selectedCompletedOrders =
    selectedSymbol === undefined ? [] : completedOrders ?? [];

  if (orders.length === 0 && selectedCompletedOrders.length === 0) {
    return (
      <CollapsibleCard title="주문 내역" storageId="orders" refreshing={refreshing}>
        <p className={styles.empty}>주문 없음</p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard title="주문 내역" storageId="orders" refreshing={refreshing}>
      {selectedSymbol !== undefined ? (
        <>
          <OrderSection
            title={`${selectedSymbol} 대기 주문`}
            emptyText="대기 주문 없음"
            orders={selectedOpenOrders}
            accountSeq={accountSeq}
            onChanged={onChanged}
          />
          <OrderSection
            title={`${selectedSymbol} 체결·완료 내역`}
            emptyText="완료 내역 없음"
            orders={selectedCompletedOrders}
            accountSeq={accountSeq}
            onChanged={onChanged}
          />
        </>
      ) : null}
      <OrderSection
        title="전체 대기 주문"
        emptyText="대기 주문 없음"
        orders={orders}
        accountSeq={accountSeq}
        onChanged={onChanged}
      />
    </CollapsibleCard>
  );
}

function OrderSection({
  title,
  emptyText,
  orders,
  accountSeq,
  onChanged,
}: {
  title: string;
  emptyText: string;
  orders: Order[];
  accountSeq?: number | undefined;
  onChanged?: () => void;
}) {
  return (
    <section className={styles.orderSection} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {orders.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">종목</th>
                <th scope="col">구분</th>
                <th scope="col">유형</th>
                <th scope="col">상태</th>
                <th scope="col">수량</th>
                <th scope="col">체결수량</th>
                <th scope="col">가격</th>
                <th scope="col">주문시각</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow
                  key={order.orderId}
                  order={order}
                  accountSeq={accountSeq}
                  onChanged={onChanged}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface CancelState {
  code: string;
  message: string;
}

/**
 * A single order row plus its inline modify/cancel actions. Cancel uses a
 * two-step inline confirmation (never a browser dialog): "취소" reveals a
 * "정말 취소? [확인] [되돌리기]" prompt in the row, and only the explicit
 * [확인] click POSTs `{ confirm: true }` to the cancel route. The result status
 * (DRY_RUN / SENT / BLOCKED) or error is shown next to the row.
 */
function OrderRow({
  order,
  accountSeq,
  onChanged,
}: {
  order: Order;
  accountSeq: number | undefined;
  onChanged?: () => void;
}) {
  const cancelable = isCancelable(order.status);
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [cancelResult, setCancelResult] = useState<CancelOrderResult | null>(
    null,
  );
  const [cancelError, setCancelError] = useState<CancelState | null>(null);

  async function handleConfirmCancel() {
    setCanceling(true);
    setCancelError(null);
    setCancelResult(null);
    try {
      // confirm:true is the user's explicit inline confirmation; the server's
      // §6 gate still decides whether this actually sends or stays a DRY_RUN.
      const result = await cancelOrder(accountSeq, order.orderId, true);
      setCancelResult(result);
      if (result.status === "SENT") {
        onChanged?.();
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCancelError({ code: err.code, message: err.message });
      } else {
        setCancelError({
          code: "unexpected-error",
          message: "취소 요청에 실패했습니다.",
        });
      }
    } finally {
      setCanceling(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <span className={styles.symbolTicker}>{order.symbol}</span>
        </td>
        <td>{order.side}</td>
        <td>{order.orderType}</td>
        <td>
          <span className={styles.marketBadge}>{order.status}</span>
        </td>
        <td>{formatDecimal(order.quantity, { maxFractionDigits: 4 })}</td>
        <td>
          {formatDecimal(order.execution.filledQuantity, {
            maxFractionDigits: 4,
          })}
        </td>
        <td>
          <Money value={formatPrice(order.price, order.currency)} />
        </td>
        <td>{formatOrderedAt(order.orderedAt)}</td>
        <td>
          {cancelable ? (
            <div className={styles.rowActions}>
              <button
                type="button"
                className={page.select}
                onClick={() => setShowModify((open) => !open)}
              >
                정정
              </button>
              {confirming ? (
                <span className={styles.confirmInline}>
                  <span>정말 취소?</span>
                  <button
                    type="button"
                    className={page.select}
                    onClick={handleConfirmCancel}
                    disabled={canceling}
                  >
                    {canceling ? "취소 중…" : "확인"}
                  </button>
                  <button
                    type="button"
                    className={page.select}
                    onClick={() => setConfirming(false)}
                    disabled={canceling}
                  >
                    되돌리기
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className={page.select}
                  onClick={() => {
                    setConfirming(true);
                    setCancelResult(null);
                    setCancelError(null);
                  }}
                >
                  취소
                </button>
              )}
            </div>
          ) : null}
        </td>
      </tr>
      {showModify || cancelResult || cancelError ? (
        <tr>
          <td colSpan={9}>
            <CancelOutcome result={cancelResult} error={cancelError} />
            {showModify ? (
              <ModifyOrderForm
                accountSeq={accountSeq}
                orderId={order.orderId}
                defaultOrderType={order.orderType === "MARKET" ? "MARKET" : "LIMIT"}
                defaultQuantity={order.quantity}
                defaultPrice={order.price ?? ""}
                onModified={onChanged}
              />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Renders the cancel outcome (status / reasons) or the error envelope. */
function CancelOutcome({
  result,
  error,
}: {
  result: CancelOrderResult | null;
  error: CancelState | null;
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
        <p className={styles.resultTitle}>🔍 취소 미리보기 (전송되지 않음)</p>
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
      <p className={styles.resultTitle}>✅ 취소 전송됨</p>
      <p>주문번호: {result.response.orderId}</p>
    </div>
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
