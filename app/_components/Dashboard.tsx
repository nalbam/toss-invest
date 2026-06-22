"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import {
  useAccounts,
  useCashBalances,
  useExchangeRate,
  useHoldings,
  useOrders,
} from "@/lib/client/hooks";
import type { AdvisorProposal } from "@/lib/client/advisor";
import { AccountCash } from "./AccountCash";
import { AiAdvisor } from "./AiAdvisor";
import { CollapsibleCard } from "./CollapsibleCard";
import { HoldingsTable } from "./HoldingsTable";
import { MarketQuote } from "./MarketQuote";
import { OrderForm } from "./OrderForm";
import { OrdersTable } from "./OrdersTable";
import { PortfolioSummary } from "./PortfolioSummary";
import page from "@/app/page.module.css";
import styles from "./dashboard.module.css";

const SELECTED_ACCOUNT_KEY = "toss-invest:selected-account-seq";
const LAST_SYMBOL_KEY = "toss-invest:last-symbol";

function symbolStorageKey(accountSeq: number): string {
  return `${LAST_SYMBOL_KEY}:${accountSeq}`;
}

function maskAccountNo(accountNo: string): string {
  if (accountNo.length <= 6) {
    return accountNo;
  }
  return `${accountNo.slice(0, 3)}${"*".repeat(
    accountNo.length - 6,
  )}${accountNo.slice(-3)}`;
}

function readLastSymbol(): string | null {
  try {
    return window.localStorage.getItem(LAST_SYMBOL_KEY);
  } catch {
    return null;
  }
}

function readStoredAccountSeq(): number | null {
  try {
    const stored = window.localStorage.getItem(SELECTED_ACCOUNT_KEY);
    if (stored === null) return null;
    const parsed = Number(stored);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredAccountSeq(accountSeq: number): void {
  try {
    window.localStorage.setItem(SELECTED_ACCOUNT_KEY, String(accountSeq));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function readStoredSymbol(accountSeq: number): string | null {
  try {
    return (
      window.localStorage.getItem(symbolStorageKey(accountSeq)) ??
      readLastSymbol()
    );
  } catch {
    return null;
  }
}

function writeStoredSymbol(accountSeq: number, symbol: string): void {
  try {
    window.localStorage.setItem(symbolStorageKey(accountSeq), symbol);
    window.localStorage.setItem(LAST_SYMBOL_KEY, symbol);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

/**
 * Client-side dashboard root. Loads accounts, defaults to the first one,
 * and composes the portfolio summary, holdings table, and FX rate. All data
 * comes from the app's own `/api/*` routes via SWR.
 */
export function Dashboard() {
  const accounts = useAccounts();
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>(undefined);
  // Symbol chosen from the holdings table; drives the market panel and order
  // form. Undefined until the user picks a holding (left panel shows a prompt).
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>(
    undefined,
  );
  // Side + quantity from an accepted AI advisor proposal, handed to the order
  // form to prefill. A fresh object per acceptance so re-accepting re-applies;
  // it only fills inputs (the user still confirms and passes the §6 gate).
  const [prefill, setPrefill] = useState<
    { side: "BUY" | "SELL"; quantity: number } | undefined
  >(undefined);

  // Restore the selected account when possible; otherwise default to the first.
  useEffect(() => {
    if (selectedSeq === undefined && accounts.data && accounts.data.length > 0) {
      const storedSeq = readStoredAccountSeq();
      const nextSeq =
        storedSeq !== null &&
        accounts.data.some((account) => account.accountSeq === storedSeq)
          ? storedSeq
          : accounts.data[0].accountSeq;
      setSelectedSeq(nextSeq);
    }
  }, [accounts.data, selectedSeq]);

  const holdings = useHoldings(selectedSeq);
  const orders = useOrders(selectedSeq);
  const fx = useExchangeRate("USD", "KRW");
  const cashBalances = useCashBalances(selectedSeq);
  const cash = { krw: cashBalances.krw, usd: cashBalances.usd };
  const { mutate } = useSWRConfig();

  // After a SENT modify/cancel, revalidate any cached `/api/orders` queries so
  // the table reflects the new state.
  function refreshOrders() {
    void mutate(
      (key) => typeof key === "string" && key.startsWith("/api/orders"),
    );
  }

  useEffect(() => {
    if (selectedSymbol !== undefined || holdings.data === undefined) {
      return;
    }
    if (selectedSeq === undefined) {
      return;
    }
    const lastSymbol = readStoredSymbol(selectedSeq);
    if (
      lastSymbol &&
      holdings.data.items.some((item) => item.symbol === lastSymbol)
    ) {
      setSelectedSymbol(lastSymbol);
    }
  }, [holdings.data, selectedSeq, selectedSymbol]);

  function selectAccount(accountSeq: number) {
    setSelectedSeq(accountSeq);
    setSelectedSymbol(undefined);
    setPrefill(undefined);
    writeStoredAccountSeq(accountSeq);
  }

  function selectSymbol(symbol: string) {
    setSelectedSymbol(symbol);
    if (selectedSeq !== undefined) {
      writeStoredSymbol(selectedSeq, symbol);
    }
  }

  // "폼에 담기" from the advisor card: point the order form at the proposed
  // symbol and prefill its side + quantity. Never sends an order.
  function applyProposal(proposal: AdvisorProposal) {
    selectSymbol(proposal.symbol);
    setPrefill({ side: proposal.side, quantity: proposal.quantity });
  }

  if (accounts.isLoading) {
    return <p className={page.status}>계좌 정보를 불러오는 중…</p>;
  }
  if (accounts.error) {
    return (
      <p className={`${page.status} ${page.error}`} role="alert">
        계좌 정보를 불러오지 못했습니다: {accounts.error.message}
      </p>
    );
  }
  if (!accounts.data || accounts.data.length === 0) {
    return <p className={page.status}>사용 가능한 계좌가 없습니다.</p>;
  }

  const selectedName = holdings.data?.items.find(
    (item) => item.symbol === selectedSymbol,
  )?.name;

  return (
    <div className={page.dashboard}>
      <header className={page.header}>
        <h1 className={page.title}>토스증권 대시보드</h1>
        <div className={page.controls}>
          <label htmlFor="account-select" className={page.controlLabel}>
            계좌
          </label>
          <select
            id="account-select"
            className={page.select}
            value={selectedSeq ?? ""}
            onChange={(event) => selectAccount(Number(event.target.value))}
          >
            {accounts.data.map((account) => (
              <option key={account.accountSeq} value={account.accountSeq}>
                {maskAccountNo(account.accountNo)} ({account.accountType})
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className={styles.layout}>
        {/* Left: market data for the selected symbol (or a prompt). */}
        <div className={`${styles.column} ${styles.marketColumn}`}>
          {selectedSymbol ? (
            <MarketQuote symbol={selectedSymbol} name={selectedName} />
          ) : (
            <CollapsibleCard title="시세" storageId="market-quote">
              <p className={styles.placeholder}>보유 종목을 선택하세요.</p>
            </CollapsibleCard>
          )}
        </div>

        {/* Center: order form, then the AI advisor and order history. */}
        <div className={styles.column}>
          {selectedSymbol ? (
            <OrderForm
              accountSeq={selectedSeq}
              symbol={selectedSymbol}
              name={selectedName}
              cash={cash}
              fxRate={fx.data?.rate}
              prefill={prefill}
            />
          ) : (
            <CollapsibleCard title="주문하기" storageId="order-form">
              <p className={styles.placeholder}>
                보유 종목을 선택하면 주문할 수 있습니다.
              </p>
            </CollapsibleCard>
          )}

          <AiAdvisor accountSeq={selectedSeq} onSelectProposal={applyProposal} />

          {orders.isLoading ? (
            <p className={page.status}>주문 내역을 불러오는 중…</p>
          ) : orders.error ? (
            <p className={`${page.status} ${page.error}`} role="alert">
              주문 내역을 불러오지 못했습니다: {orders.error.message}
            </p>
          ) : orders.data ? (
            <OrdersTable
              orders={orders.data.orders}
              accountSeq={selectedSeq}
              onChanged={refreshOrders}
              refreshing={Boolean(orders.isRefreshing)}
            />
          ) : null}
        </div>

        {/* Right: account sidebar — cash, summary, holdings. */}
        <div className={styles.column}>
          {fx.data ? (
            <AccountCash
              rate={fx.data}
              cash={cash}
              refreshing={Boolean(fx.isRefreshing || cashBalances.isRefreshing)}
            />
          ) : null}

          {holdings.isLoading ? (
            <p className={page.status}>보유 자산을 불러오는 중…</p>
          ) : holdings.error ? (
            <p className={`${page.status} ${page.error}`} role="alert">
              보유 자산을 불러오지 못했습니다: {holdings.error.message}
            </p>
          ) : holdings.data ? (
            <>
              <PortfolioSummary
                overview={holdings.data}
                cash={cash}
                fxRate={fx.data?.rate}
                refreshing={Boolean(holdings.isRefreshing)}
              />
              <HoldingsTable
                items={holdings.data.items}
                selectedSymbol={selectedSymbol}
                onSelectSymbol={selectSymbol}
                refreshing={Boolean(holdings.isRefreshing)}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
