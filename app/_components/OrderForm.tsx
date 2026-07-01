"use client";

import { CollapsibleCard } from "./CollapsibleCard";
import { GeneralOrderForm } from "./GeneralOrderForm";
import { OrderResult } from "./OrderResult";
import { QuickOrderForm } from "./QuickOrderForm";
import { useOrderForm, type Side } from "./useOrderForm";
import styles from "./dashboard.module.css";

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
 * (DRY_RUN / SENT / BLOCKED) and any `{ error }` envelope surfaces its
 * human-readable message.
 */
export function OrderForm({
  accountSeq,
  symbol,
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
  const form = useOrderForm({ accountSeq, symbol, name, cash, fxRate, prefill });
  const { mode, changeMode, handleSubmit, result, error } = form;
  const activeTabId =
    mode === "QUICK" ? "order-tab-quick" : "order-tab-general";

  return (
    <CollapsibleCard title="주문하기" storageId="order-form">
      <div className={styles.orderTabs} role="tablist" aria-label="주문 방식">
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          id="order-tab-quick"
          aria-controls="order-panel"
          aria-selected={mode === "QUICK"}
          onClick={() => changeMode("QUICK")}
        >
          빠른주문
        </button>
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          id="order-tab-general"
          aria-controls="order-panel"
          aria-selected={mode === "GENERAL"}
          onClick={() => changeMode("GENERAL")}
        >
          일반주문
        </button>
        <button
          type="button"
          className={styles.orderTab}
          role="tab"
          aria-selected={false}
          aria-disabled={true}
          disabled
        >
          조건주문
        </button>
      </div>

      <form
        className={styles.orderForm}
        id="order-panel"
        role="tabpanel"
        aria-labelledby={activeTabId}
        onSubmit={handleSubmit}
      >
        {mode === "GENERAL" ? (
          <GeneralOrderForm form={form} />
        ) : (
          <QuickOrderForm form={form} />
        )}
      </form>

      <OrderResult result={result} error={error} />
    </CollapsibleCard>
  );
}
