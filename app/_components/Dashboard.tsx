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
import { HoldingsPnL } from "./HoldingsPnL";
import { HoldingsTable } from "./HoldingsTable";
import { MarketQuote } from "./MarketQuote";
import { OrderForm } from "./OrderForm";
import { OrdersTable } from "./OrdersTable";
import { PortfolioComposition } from "./PortfolioComposition";
import { PortfolioSummary } from "./PortfolioSummary";
import { StockSearchModal } from "./StockSearchModal";
import { ThemeSelector } from "./ThemeSelector";
import { WatchlistControls } from "./WatchlistControls";
import page from "@/app/page.module.css";
import styles from "./dashboard.module.css";

const SELECTED_ACCOUNT_KEY = "toss-invest:selected-account-seq";
const LAST_SYMBOL_KEY = "toss-invest:last-symbol";
const LAST_SYMBOL_SELECTION_KEY = "toss-invest:last-symbol-selection";
const DEFAULT_TITLE = "토스증권 대시보드";

interface StoredSymbolSelection {
  symbol: string;
  name?: string;
}

function symbolStorageKey(accountSeq: number): string {
  return `${LAST_SYMBOL_KEY}:${accountSeq}`;
}

function symbolSelectionStorageKey(accountSeq: number): string {
  return `${LAST_SYMBOL_SELECTION_KEY}:${accountSeq}`;
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
    return window.localStorage.getItem(symbolStorageKey(accountSeq));
  } catch {
    return null;
  }
}

function isStoredSymbolSelection(
  value: unknown,
): value is StoredSymbolSelection {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const selection = value as Partial<StoredSymbolSelection>;
  return (
    typeof selection.symbol === "string" &&
    selection.symbol.length > 0 &&
    (selection.name === undefined || typeof selection.name === "string")
  );
}

function readStoredSymbolSelection(
  accountSeq: number,
): StoredSymbolSelection | null {
  try {
    const stored = window.localStorage.getItem(
      symbolSelectionStorageKey(accountSeq),
    );
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      if (isStoredSymbolSelection(parsed)) {
        return parsed;
      }
    }
    const symbol = readStoredSymbol(accountSeq);
    return symbol === null ? null : { symbol };
  } catch {
    return null;
  }
}

function readLegacySymbolSelection(): StoredSymbolSelection | null {
  try {
    const stored = window.localStorage.getItem(LAST_SYMBOL_SELECTION_KEY);
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      if (isStoredSymbolSelection(parsed)) {
        return parsed;
      }
    }
    const symbol = readLastSymbol();
    return symbol === null ? null : { symbol };
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

function writeStoredSymbolSelection(
  accountSeq: number,
  selection: StoredSymbolSelection,
): void {
  writeStoredSymbol(accountSeq, selection.symbol);
  try {
    window.localStorage.setItem(
      symbolSelectionStorageKey(accountSeq),
      JSON.stringify(selection),
    );
    window.localStorage.setItem(
      LAST_SYMBOL_SELECTION_KEY,
      JSON.stringify(selection),
    );
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
  const [privacyBlurred, setPrivacyBlurred] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
  // Display name for a selected symbol the user does not hold (resolved by the
  // advisor route and restored from storage). Lets the market panel/order form
  // label it like a holding.
  const [selectedSymbolName, setSelectedSymbolName] = useState<
    { symbol: string; name: string } | undefined
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        setPrivacyBlurred((current) => !current);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const holdings = useHoldings(selectedSeq);
  const orders = useOrders(selectedSeq);
  // Terminal orders for the selected symbol only (paused until one is picked).
  const completedOrders = useOrders(
    selectedSymbol === undefined ? undefined : selectedSeq,
    { status: "CLOSED", symbol: selectedSymbol },
  );
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
    const accountSelection = readStoredSymbolSelection(selectedSeq);
    const legacySelection = readLegacySymbolSelection();
    const lastSelection =
      accountSelection ??
      (legacySelection &&
      holdings.data.items.some((item) => item.symbol === legacySelection.symbol)
        ? legacySelection
        : null);
    if (lastSelection) {
      setSelectedSymbol(lastSelection.symbol);
      setSelectedSymbolName(
        lastSelection.name
          ? { symbol: lastSelection.symbol, name: lastSelection.name }
          : undefined,
      );
    }
  }, [holdings.data, selectedSeq, selectedSymbol]);

  useEffect(() => {
    if (selectedSymbol === undefined) {
      document.title = DEFAULT_TITLE;
    }
  }, [selectedSymbol]);

  function selectAccount(accountSeq: number) {
    setSelectedSeq(accountSeq);
    setSelectedSymbol(undefined);
    setPrefill(undefined);
    setSelectedSymbolName(undefined);
    writeStoredAccountSeq(accountSeq);
  }

  function selectSymbol(symbol: string, name?: string) {
    setSelectedSymbol(symbol);
    setSelectedSymbolName(name ? { symbol, name } : undefined);
    if (selectedSeq !== undefined) {
      writeStoredSymbolSelection(
        selectedSeq,
        name === undefined ? { symbol } : { symbol, name },
      );
    }
  }

  // "폼에 담기" from the advisor card: point the order form at the proposed
  // symbol, prefill its side + quantity, and remember its resolved name so a
  // non-held symbol is labelled like a holding. Never sends an order.
  function applyProposal(proposal: AdvisorProposal, name?: string) {
    selectSymbol(proposal.symbol, name);
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

  const selectedHolding = holdings.data?.items.find(
    (item) => item.symbol === selectedSymbol,
  );
  // Prefer the holding's name; fall back to a proposed symbol's resolved name so
  // a non-held proposed symbol is labelled the same way a holding is.
  const selectedName =
    selectedHolding?.name ??
    (selectedSymbolName && selectedSymbolName.symbol === selectedSymbol
      ? selectedSymbolName.name
      : undefined);

  return (
    <div
      className={`${page.dashboard} ${privacyBlurred ? page.privacyBlurred : ""}`}
      data-privacy-blurred={privacyBlurred ? "true" : "false"}
    >
      <header className={page.header}>
        <h1 className={page.title}>토스증권 대시보드</h1>
        <div className={page.headerControls}>
          <button
            type="button"
            className={page.select}
            onClick={() => setSearchOpen(true)}
          >
            종목 검색
          </button>
          <ThemeSelector />
          <div className={page.controls}>
            <label htmlFor="account-select" className={page.controlLabel}>
              계좌
            </label>
            <select
              id="account-select"
              className={page.select}
              value={selectedSeq ?? ""}
              onChange={(event) => selectAccount(Number(event.target.value))}
              data-private-value="true"
            >
              {accounts.data.map((account) => (
                <option key={account.accountSeq} value={account.accountSeq}>
                  {account.accountNo} ({account.accountType})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <StockSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={selectSymbol}
      />

      <div className={styles.layout}>
        {/* Left: market data for the selected symbol (or a prompt). */}
        <div className={`${styles.column} ${styles.marketColumn}`}>
          {selectedSymbol ? (
            <MarketQuote
              symbol={selectedSymbol}
              name={selectedName}
              orders={orders.data?.orders ?? []}
              averagePurchasePrice={selectedHolding?.averagePurchasePrice}
              quantity={selectedHolding?.quantity}
            />
          ) : (
            <CollapsibleCard title="시세" storageId="market-quote">
              <p className={styles.placeholder}>
                보유 종목을 선택하거나 상단 “종목 검색”으로 종목을 찾으세요.
              </p>
            </CollapsibleCard>
          )}
          <WatchlistControls />
        </div>

        {/* Center: order form and order history. */}
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

          {orders.isLoading ? (
            <p className={page.status}>주문 내역을 불러오는 중…</p>
          ) : orders.error ? (
            <p className={`${page.status} ${page.error}`} role="alert">
              주문 내역을 불러오지 못했습니다: {orders.error.message}
            </p>
          ) : orders.data ? (
            <OrdersTable
              orders={orders.data.orders}
              completedOrders={completedOrders.data?.orders ?? []}
              accountSeq={selectedSeq}
              selectedSymbol={selectedSymbol}
              onChanged={refreshOrders}
              refreshing={Boolean(
                orders.isRefreshing || completedOrders.isRefreshing,
              )}
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
              <PortfolioComposition
                items={holdings.data.items}
                fxRate={fx.data?.rate}
                refreshing={Boolean(holdings.isRefreshing)}
              />
              <HoldingsPnL
                items={holdings.data.items}
                refreshing={Boolean(holdings.isRefreshing)}
              />
              <AiAdvisor
                accountSeq={selectedSeq}
                onSelectProposal={applyProposal}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
