"use client";

import { useEffect, useState } from "react";
import {
  useAccounts,
  useExchangeRate,
  useHoldings,
} from "@/lib/client/hooks";
import { FxRate } from "./FxRate";
import { HoldingsTable } from "./HoldingsTable";
import { PortfolioSummary } from "./PortfolioSummary";
import page from "@/app/page.module.css";

/**
 * Client-side dashboard root. Loads accounts, defaults to the first one,
 * and composes the portfolio summary, holdings table, and FX rate. All data
 * comes from the app's own `/api/*` routes via SWR.
 */
export function Dashboard() {
  const accounts = useAccounts();
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>(undefined);

  // Default to the first account once the list arrives.
  useEffect(() => {
    if (selectedSeq === undefined && accounts.data && accounts.data.length > 0) {
      setSelectedSeq(accounts.data[0].accountSeq);
    }
  }, [accounts.data, selectedSeq]);

  const holdings = useHoldings(selectedSeq);
  const fx = useExchangeRate("USD", "KRW");

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

      {fx.data ? <FxRate rate={fx.data} /> : null}

      {holdings.isLoading ? (
        <p className={page.status}>보유 자산을 불러오는 중…</p>
      ) : holdings.error ? (
        <p className={`${page.status} ${page.error}`} role="alert">
          보유 자산을 불러오지 못했습니다: {holdings.error.message}
        </p>
      ) : holdings.data ? (
        <>
          <PortfolioSummary overview={holdings.data} />
          <HoldingsTable items={holdings.data.items} />
        </>
      ) : null}
    </div>
  );
}
