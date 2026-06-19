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
import { AccountCash } from "./AccountCash";
import { HoldingsTable } from "./HoldingsTable";
import { MarketQuote } from "./MarketQuote";
import { OrderForm } from "./OrderForm";
import { OrdersTable } from "./OrdersTable";
import { PortfolioSummary } from "./PortfolioSummary";
import page from "@/app/page.module.css";
import styles from "./dashboard.module.css";

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

  // Default to the first account once the list arrives.
  useEffect(() => {
    if (selectedSeq === undefined && accounts.data && accounts.data.length > 0) {
      setSelectedSeq(accounts.data[0].accountSeq);
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
      <div className={page.controls}>
        <label htmlFor="account-select" className={page.controlLabel}>
          계좌
        </label>
        <select
          id="account-select"
          className={page.select}
          value={selectedSeq ?? ""}
          onChange={(event) => setSelectedSeq(Number(event.target.value))}
        >
          {accounts.data.map((account) => (
            <option key={account.accountSeq} value={account.accountSeq}>
              {account.accountNo} ({account.accountType})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.layout}>
        {/* Left: market data for the selected symbol (or a prompt). */}
        <div className={`${styles.column} ${styles.marketColumn}`}>
          {selectedSymbol ? (
            <MarketQuote symbol={selectedSymbol} name={selectedName} />
          ) : (
            <section className={styles.card} aria-label="시세">
              <h2 className={styles.cardTitle}>시세</h2>
              <p className={styles.placeholder}>보유 종목을 선택하세요.</p>
            </section>
          )}
        </div>

        {/* Center: order form for the selected symbol (or a prompt). */}
        <div className={styles.column}>
          {selectedSymbol ? (
            <OrderForm accountSeq={selectedSeq} symbol={selectedSymbol} />
          ) : (
            <section className={styles.card} aria-label="주문하기">
              <h2 className={styles.cardTitle}>주문하기</h2>
              <p className={styles.placeholder}>
                보유 종목을 선택하면 주문할 수 있습니다.
              </p>
            </section>
          )}
        </div>

        {/* Right: account sidebar — cash, summary, holdings, orders. */}
        <div className={styles.column}>
          {fx.data ? <AccountCash rate={fx.data} cash={cash} /> : null}

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
              />
              <HoldingsTable
                items={holdings.data.items}
                selectedSymbol={selectedSymbol}
                onSelectSymbol={setSelectedSymbol}
              />
            </>
          ) : null}

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
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
