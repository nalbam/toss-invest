import "server-only";
import {
  cancelOrderRaw,
  createOrderRaw,
  modifyOrderRaw,
} from "@/lib/server/toss/endpoints";
import type { TossClient } from "@/lib/server/toss/client";
import {
  cancelOrder,
  getTradingConfig,
  modifyOrder,
  placeOrder,
  type AuditEntry,
  type CancelOrderInput,
  type CancelOrderResult,
  type ModifyOrderInput,
  type ModifyOrderResult,
  type OrderOpAuditEntry,
  type PlaceOrderInput,
  type PlaceOrderResult,
} from "@/lib/server/trading/safety";

/**
 * Gated trading executor facade exposed to Route Handlers. It binds the §6
 * safety executors (`placeOrder`/`modifyOrder`/`cancelOrder`) to the live raw
 * POST calls, the resolved trading config, a wall clock, and a secret-free
 * audit logger. The raw `POST /orders*` calls are reachable ONLY through these
 * gated executors — never exposed directly — so every real order must pass the
 * §6 gate first.
 *
 * The caller (a route) supplies the per-order `confirm` and the gate context
 * (`fxRate`/`referencePrice`/`originalQuantity`) and the `accountSeq`; this
 * facade never invents a confirm or relaxes any gate input.
 */
export interface ServerTradingExecutor {
  placeOrder(
    accountSeq: number | string,
    input: PlaceOrderInput,
  ): Promise<PlaceOrderResult>;
  modifyOrder(
    accountSeq: number | string,
    input: ModifyOrderInput,
  ): Promise<ModifyOrderResult>;
  cancelOrder(
    accountSeq: number | string,
    input: CancelOrderInput,
  ): Promise<CancelOrderResult>;
}

/**
 * Secret-free audit logger. Emits the structured §6 audit entry as JSON to the
 * server console; `summarizeOrder`/`summarizeModify` in `safety.ts` already
 * strip auth material, so only an order summary, decision, reasons, and notional
 * are recorded.
 */
function auditLog(entry: AuditEntry | OrderOpAuditEntry): void {
  console.info("[trading-audit]", JSON.stringify(entry));
}

/**
 * Builds the gated executor facade over a live Toss client. The §6 gate is run
 * inside each `safety.ts` executor; this only injects I/O (raw POSTs, clock,
 * audit) and the resolved config. The config is read per call via
 * `getTradingConfig()` so a flipped env (e.g. KILL_SWITCH) takes effect without
 * a process restart.
 */
export function createServerTradingExecutor(
  client: TossClient,
): ServerTradingExecutor {
  const now = () => Date.now();
  return {
    placeOrder: (accountSeq, input) =>
      placeOrder(input, {
        config: getTradingConfig(),
        createOrderRaw: (params) => createOrderRaw(client, params),
        now,
        auditLog,
        accountSeq,
      }),
    modifyOrder: (accountSeq, input) =>
      modifyOrder(input, {
        config: getTradingConfig(),
        modifyOrderRaw: (params) => modifyOrderRaw(client, params),
        now,
        auditLog,
        accountSeq,
      }),
    cancelOrder: (accountSeq, input) =>
      cancelOrder(input, {
        config: getTradingConfig(),
        cancelOrderRaw: (params) => cancelOrderRaw(client, params),
        now,
        auditLog,
        accountSeq,
      }),
  };
}
