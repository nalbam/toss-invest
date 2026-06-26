"use client";

import { useState, type ReactNode } from "react";
import { ApiClientError, cancelOrder } from "@/lib/client/hooks";
import type { CancelOrderResult, Currency, Order } from "@/lib/client/types";
import {
  addDecimalStrings,
  formatDecimal,
  formatKrw,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  mulDecimalStrings,
  signOf,
} from "@/lib/client/format";
import { CollapsibleCard } from "./CollapsibleCard";
import { Money } from "./Money";
import { ModifyOrderForm } from "./ModifyOrderForm";
import styles from "./dashboard.module.css";
import page from "@/app/page.module.css";

/** Formats an order price in the order's own trading currency. */
function formatPrice(value: string | null, currency: string): string {
  return currency === "USD" ? formatUsd(value) : formatKrw(value);
}

/** Negates a decimal string, so `a - b` can be written `add(a, negate(b))`. */
function negate(value: string): string {
  return mulDecimalStrings(value, "-1");
}

/** Buy/sell totals plus the realized P&L for one symbol's completed orders. */
export interface TradeSummary {
  buyQty: string;
  buyAmount: string;
  sellQty: string;
  sellAmount: string;
  /** Realized gain/loss on the sold shares, or null when it can't be derived. */
  realizedPnl: string | null;
  /** Realized return on the sold cost basis (ratio, e.g. "0.012"), or null. */
  realizedPnlRate: string | null;
  currency: Currency;
}

/**
 * Aggregates a single symbol's completed orders into a buy/sell + realized-P&L
 * summary. Only orders with a positive filled quantity contribute
 * (canceled/rejected ones have zero fills and drop out). Each order's filled
 * value is `execution.filledAmount`, falling back to averageFilledPrice ×
 * filledQuantity when the amount is absent.
 *
 * `realizedPnl` is the gain/loss on the SOLD shares — sell proceeds (less their
 * commission + tax) minus their cost basis (sold quantity × unit cost). The unit
 * cost is `averagePurchasePrice` when given (it covers buys made outside this
 * page), else the buy-side weighted average of the loaded fills. It is null when
 * nothing was sold or no cost basis is known, so the row can be omitted. The
 * still-held position's unrealized P&L is shown separately on the holding card,
 * not here.
 *
 * Returns null when no order carries a fill. Note: `orders` is the most recent
 * CLOSED page for the symbol (cursor unused), so this reflects the loaded
 * completed history, not the full lifetime ledger.
 */
export function summarizeCompletedTrades(
  orders: Order[],
  averagePurchasePrice?: string | null,
): TradeSummary | null {
  let buyQty = "0";
  let buyAmount = "0";
  let sellQty = "0";
  let sellAmount = "0";
  let sellFee = "0";
  let currency: Currency | null = null;
  let hasFill = false;

  for (const order of orders) {
    const qty = order.execution.filledQuantity;
    if (!(Number(qty) > 0)) {
      continue;
    }
    hasFill = true;
    currency ??= order.currency;
    const amount =
      order.execution.filledAmount ??
      mulDecimalStrings(order.execution.averageFilledPrice, qty);
    const commission = order.execution.commission ?? "0";
    const tax = order.execution.tax ?? "0";
    if (order.side === "SELL") {
      sellQty = addDecimalStrings(sellQty, qty);
      sellAmount = addDecimalStrings(sellAmount, amount);
      sellFee = addDecimalStrings(sellFee, addDecimalStrings(commission, tax));
    } else {
      buyQty = addDecimalStrings(buyQty, qty);
      buyAmount = addDecimalStrings(buyAmount, amount);
    }
  }

  if (!hasFill) {
    return null;
  }

  // Unit cost for the sold shares: prefer the holding's average purchase price
  // (it covers buys outside this page), else the buy-side weighted average of
  // the loaded fills. The weighted-average fallback is a display approximation.
  let unitCost: string | null = null;
  if (averagePurchasePrice != null && Number(averagePurchasePrice) > 0) {
    unitCost = averagePurchasePrice;
  } else if (Number(buyQty) > 0) {
    unitCost = String(Number(buyAmount) / Number(buyQty));
  }

  // Realized P&L only applies when shares were sold and a cost basis is known.
  let realizedPnl: string | null = null;
  let realizedPnlRate: string | null = null;
  if (Number(sellQty) > 0 && unitCost != null) {
    const cost = mulDecimalStrings(unitCost, sellQty);
    const sellNet = addDecimalStrings(sellAmount, negate(sellFee));
    realizedPnl = addDecimalStrings(sellNet, negate(cost));
    if (Number(cost) !== 0) {
      realizedPnlRate = String(Number(realizedPnl) / Number(cost));
    }
  }

  return {
    buyQty,
    buyAmount,
    sellQty,
    sellAmount,
    realizedPnl,
    realizedPnlRate,
    currency: currency ?? "KRW",
  };
}

/**
 * Renders an ISO date-time as "YYYY-MM-DD HH:mm" when parseable, otherwise the
 * raw string. Used as the full-precision tooltip behind the compact relative
 * age, deterministically (no locale/timezone dependence).
 */
function formatOrderedAt(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

/** BUY/SELL glyph + label + color class (red buy / blue sell, KR convention). */
const SIDE_META: Record<string, { icon: string; label: string; className: string }> = {
  BUY: { icon: "+", label: "매수", className: styles.orderSideBuy },
  SELL: { icon: "−", label: "매도", className: styles.orderSideSell },
};

function sideMeta(side: string) {
  return SIDE_META[side] ?? { icon: "•", label: side, className: "" };
}

/** Abbreviated order type. */
const ORDER_TYPE_LABEL: Record<string, string> = {
  LIMIT: "지정",
  MARKET: "시장",
};

/** Status glyph + Korean label + tone class, keyed by `orders[].status`. */
const STATUS_META: Record<string, { icon: string; label: string; tone: string }> = {
  PENDING: { icon: "⏳", label: "대기", tone: styles.statusPending },
  PARTIAL_FILLED: { icon: "◐", label: "부분체결", tone: styles.statusPending },
  PENDING_CANCEL: { icon: "↻", label: "취소중", tone: styles.statusPending },
  PENDING_REPLACE: { icon: "↻", label: "정정중", tone: styles.statusPending },
  FILLED: { icon: "✓", label: "체결", tone: styles.statusDone },
  REPLACED: { icon: "↺", label: "정정됨", tone: styles.statusDone },
  CANCELED: { icon: "✕", label: "취소", tone: styles.statusMuted },
  REJECTED: { icon: "⚠", label: "거부", tone: styles.statusWarn },
  CANCEL_REJECTED: { icon: "⚠", label: "취소거부", tone: styles.statusWarn },
  REPLACE_REJECTED: { icon: "⚠", label: "정정거부", tone: styles.statusWarn },
};

function statusMeta(status: string) {
  return (
    STATUS_META[status] ?? { icon: "•", label: status, tone: styles.statusMuted }
  );
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
 * Compact two-line card list of orders. Each card shows, on the top line, the
 * side (▲ buy / ▼ sell), symbol, order type, and a status badge; on the bottom
 * line, filled/ordered quantity, price, a relative order age, and (for pending
 * orders) inline modify/cancel actions. The layout has no fixed columns so it
 * never needs horizontal scrolling. Renders an empty state when there are none.
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
  averagePurchasePrice,
  onChanged,
  refreshing,
}: {
  orders: Order[];
  completedOrders?: Order[];
  accountSeq?: number | undefined;
  selectedSymbol?: string;
  averagePurchasePrice?: string | null;
  onChanged?: () => void;
  refreshing?: boolean;
}) {
  const selectedOpenOrders =
    selectedSymbol === undefined
      ? []
      : orders.filter((order) => order.symbol === selectedSymbol);
  const selectedCompletedOrders =
    selectedSymbol === undefined ? [] : completedOrders ?? [];
  const tradeSummary =
    selectedSymbol === undefined
      ? null
      : summarizeCompletedTrades(selectedCompletedOrders, averagePurchasePrice);

  if (orders.length === 0 && selectedCompletedOrders.length === 0) {
    return (
      <CollapsibleCard title="주문 내역" storageId="orders" refreshing={refreshing}>
        <p className={styles.empty}>주문 없음</p>
      </CollapsibleCard>
    );
  }

  // One reference instant for every relative age in this render pass.
  const nowMs = Date.now();

  return (
    <CollapsibleCard title="주문 내역" storageId="orders" refreshing={refreshing}>
      {selectedSymbol !== undefined ? (
        <>
          <OrderSection
            title={`${selectedSymbol} 대기 주문`}
            emptyText="대기 주문 없음"
            orders={selectedOpenOrders}
            hideSymbol
            accountSeq={accountSeq}
            onChanged={onChanged}
            nowMs={nowMs}
          />
          <OrderSection
            title={`${selectedSymbol} 체결·완료 내역`}
            emptyText="완료 내역 없음"
            orders={selectedCompletedOrders}
            summary={
              tradeSummary ? <TradeSummaryCard summary={tradeSummary} /> : undefined
            }
            hideSymbol
            accountSeq={accountSeq}
            onChanged={onChanged}
            nowMs={nowMs}
          />
        </>
      ) : null}
      <OrderSection
        title="전체 대기 주문"
        emptyText="대기 주문 없음"
        orders={orders}
        accountSeq={accountSeq}
        onChanged={onChanged}
        nowMs={nowMs}
      />
    </CollapsibleCard>
  );
}

function OrderSection({
  title,
  emptyText,
  orders,
  summary,
  hideSymbol,
  accountSeq,
  onChanged,
  nowMs,
}: {
  title: string;
  emptyText: string;
  orders: Order[];
  summary?: ReactNode;
  hideSymbol?: boolean;
  accountSeq?: number | undefined;
  onChanged?: () => void;
  nowMs: number;
}) {
  return (
    <section className={styles.orderSection} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {summary}
      {orders.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.orderList}>
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              hideSymbol={hideSymbol}
              accountSeq={accountSeq}
              onChanged={onChanged}
              nowMs={nowMs}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Compact buy/sell totals and realized P&L for the selected symbol, shown above
 * its completed-order list. Realized P&L (gain/loss on the sold shares) is tinted
 * by sign — gain colour when positive, loss when negative — with an explicit
 * leading "+" on a positive value and the return rate beside it. It reads "-"
 * when no cost basis is available (e.g. nothing sold yet). The still-held
 * position's unrealized P&L lives on the holding card, not here.
 */
function TradeSummaryCard({ summary }: { summary: TradeSummary }) {
  const pnlSign = signOf(summary.realizedPnl);
  return (
    <div className={styles.tradeSummary}>
      <div className={styles.tradeSummaryRow}>
        <span className={styles.tradeSummaryLabel}>매수</span>
        <span className={styles.tradeSummaryValue} data-private-value="true">
          <Money value={formatPrice(summary.buyAmount, summary.currency)} />
          <span aria-hidden="true"> · </span>
          {formatDecimal(summary.buyQty, { maxFractionDigits: 4 })}주
        </span>
      </div>
      <div className={styles.tradeSummaryRow}>
        <span className={styles.tradeSummaryLabel}>매도</span>
        <span className={styles.tradeSummaryValue} data-private-value="true">
          <Money value={formatPrice(summary.sellAmount, summary.currency)} />
          <span aria-hidden="true"> · </span>
          {formatDecimal(summary.sellQty, { maxFractionDigits: 4 })}주
        </span>
      </div>
      <div className={styles.tradeSummaryRow}>
        <span
          className={styles.tradeSummaryLabel}
          title="매도분 실현손익 (매도금액 − 매도수량 × 평균단가)"
        >
          실현손익
        </span>
        {summary.realizedPnl === null ? (
          <span className={styles.tradeSummaryValue}>-</span>
        ) : (
          <span
            className={`${styles.tradeSummaryNet} ${styles[pnlSign]}`}
            data-private-value="true"
          >
            <span>
              {pnlSign === "positive" ? "+" : ""}
              <Money value={formatPrice(summary.realizedPnl, summary.currency)} />
            </span>
            {summary.realizedPnlRate !== null ? (
              <span className={styles.tradeSummaryRate}>
                {" "}
                ({formatPercent(summary.realizedPnlRate)})
              </span>
            ) : null}
          </span>
        )}
      </div>
    </div>
  );
}

interface CancelState {
  code: string;
  message: string;
}

/**
 * A single order card plus its inline modify/cancel actions. Cancel uses a
 * two-step inline confirmation (never a browser dialog): the ✕ button reveals a
 * "정말 취소? [확인] [되돌리기]" prompt, and only the explicit [확인] click POSTs
 * `{ confirm: true }` to the cancel route. The result status (DRY_RUN / SENT /
 * BLOCKED) or error is shown below the card.
 */
function OrderCard({
  order,
  hideSymbol,
  accountSeq,
  onChanged,
  nowMs,
}: {
  order: Order;
  hideSymbol?: boolean;
  accountSeq: number | undefined;
  onChanged?: () => void;
  nowMs: number;
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

  const side = sideMeta(order.side);
  const status = statusMeta(order.status);
  // Limit orders carry an order price; market orders don't, so fall back to the
  // average fill price once (partially) filled. Null only for an unfilled market
  // order, which has no price yet → shown as "시장가".
  const displayPrice = order.price ?? order.execution.averageFilledPrice;
  const isFillPrice = order.price === null && displayPrice !== null;
  const filled = formatDecimal(order.execution.filledQuantity, {
    maxFractionDigits: 4,
  });
  const quantity = formatDecimal(order.quantity, { maxFractionDigits: 4 });

  const sideIcon = (
    <span
      className={side.className}
      role="img"
      aria-label={side.label}
      title={side.label}
    >
      {side.icon}
    </span>
  );
  const typeTag = (
    <span className={styles.orderTypeTag}>
      {ORDER_TYPE_LABEL[order.orderType] ?? order.orderType}
    </span>
  );
  const statusBadge = (
    <span className={`${styles.orderStatus} ${status.tone}`}>
      <span aria-hidden="true">{status.icon}</span> {status.label}
    </span>
  );
  const metaInfo = (
    <>
      {displayPrice === null ? (
        <span className={styles.orderPrice}>시장가</span>
      ) : (
        <span
          className={styles.orderPrice}
          data-private-value="true"
          title={isFillPrice ? "체결 평균가" : undefined}
        >
          <Money value={formatPrice(displayPrice, order.currency)} />
        </span>
      )}
      <span aria-hidden="true">·</span>
      <span className={styles.orderQty} data-private-value="true">
        {filled}/{quantity}
      </span>
      <span aria-hidden="true">·</span>
      <time
        className={styles.orderTime}
        dateTime={order.orderedAt}
        title={formatOrderedAt(order.orderedAt)}
      >
        {formatRelativeTime(order.orderedAt, nowMs)}
      </time>
    </>
  );
  const actions = cancelable ? (
    <div className={styles.rowActions}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="정정"
        title="정정"
        onClick={() => setShowModify((open) => !open)}
      >
        ✎
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
          className={styles.iconButton}
          aria-label="취소"
          title="취소"
          onClick={() => {
            setConfirming(true);
            setCancelResult(null);
            setCancelError(null);
          }}
        >
          ✕
        </button>
      )}
    </div>
  ) : null;
  const extra =
    showModify || cancelResult || cancelError ? (
      <div className={styles.orderCardExtra}>
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
      </div>
    ) : null;

  // When a symbol is already selected the cards live under a per-symbol heading,
  // so the repeated symbol code is dropped and the whole row collapses to one
  // line. Otherwise (the mixed "전체 대기 주문" list) the symbol stays and the
  // two-line layout is kept.
  return (
    <li className={styles.orderCard}>
      {hideSymbol ? (
        <div className={styles.orderCardCompact}>
          <span className={styles.orderMeta}>
            {sideIcon}
            {typeTag}
            <span aria-hidden="true">·</span>
            {metaInfo}
          </span>
          <span className={styles.orderActionsGroup}>
            {statusBadge}
            {actions}
          </span>
        </div>
      ) : (
        <>
          <div className={styles.orderCardTop}>
            <span className={styles.orderIdent}>
              {sideIcon}
              <span className={styles.orderSymbol}>{order.symbol}</span>
              {typeTag}
            </span>
            {statusBadge}
          </div>
          <div className={styles.orderCardBottom}>
            <span className={styles.orderMeta}>{metaInfo}</span>
            {actions}
          </div>
        </>
      )}
      {extra}
    </li>
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
