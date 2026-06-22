"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/client/hooks";
import {
  fetchAdvisor,
  type AdvisorProposal,
  type AdvisorResult,
  type ValidatedProposal,
} from "@/lib/client/advisor";
import {
  AdvisorAutoControls,
  type AdvisorAutoInterval,
} from "./AdvisorAutoControls";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: AdvisorResult }
  | { status: "error"; message: string; notConfigured: boolean };

const ADVISOR_RESULT_KEY = "toss-invest:ai-advisor-result";

const KIND_LABEL: Record<AdvisorProposal["kind"], string> = {
  buy: "신규 매수",
  trim: "비중 축소",
  exit: "전량 매도",
  rebalance: "리밸런싱",
};

function storageKey(accountSeq?: number): string {
  return accountSeq === undefined
    ? ADVISOR_RESULT_KEY
    : `${ADVISOR_RESULT_KEY}:${accountSeq}`;
}

function isAdvisorResult(value: unknown): value is AdvisorResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Partial<AdvisorResult>;
  return (
    typeof result.advice === "string" &&
    typeof result.model === "string" &&
    typeof result.generatedAt === "string" &&
    Array.isArray(result.proposals)
  );
}

function readStoredResult(accountSeq?: number): AdvisorResult | null {
  try {
    const stored = window.localStorage.getItem(storageKey(accountSeq));
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isAdvisorResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredResult(accountSeq: number | undefined, result: AdvisorResult): void {
  try {
    window.localStorage.setItem(storageKey(accountSeq), JSON.stringify(result));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function ProposalRow({
  item,
  onSelect,
}: {
  item: ValidatedProposal;
  onSelect?: (proposal: AdvisorProposal) => void;
}) {
  const { proposal, valid, reasons } = item;
  return (
    <li className={styles.advisorProposal}>
      <div className={styles.advisorProposalHead}>
        <span className={styles.advisorProposalKind}>{KIND_LABEL[proposal.kind]}</span>
        <span className={styles.advisorProposalSymbol}>
          {proposal.symbol} · {proposal.side} {proposal.quantity}
        </span>
      </div>
      <p className={styles.advisorProposalReason}>{proposal.rationale}</p>
      {valid ? (
        <button
          type="button"
          className={styles.advisorPrefillButton}
          onClick={() => onSelect?.(proposal)}
        >
          폼에 담기
        </button>
      ) : (
        <p className={styles.advisorInvalid}>검증 실패: {reasons.join(", ")}</p>
      )}
    </li>
  );
}

/**
 * On-demand AI advisor card. A button triggers one (paid) advisor call; the
 * result is narrative advice plus validated proposals. Valid proposals can be
 * prefilled into the order form via `onSelectProposal` — the user still confirms
 * and passes the §6 gate. Invalid (hallucinated/oversell) proposals are shown
 * with their reasons but cannot be prefilled.
 */
export function AiAdvisor({
  accountSeq,
  onSelectProposal,
}: {
  accountSeq?: number;
  onSelectProposal?: (proposal: AdvisorProposal) => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] =
    useState<AdvisorAutoInterval>(60_000);

  useEffect(() => {
    const stored = readStoredResult(accountSeq);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
  }, [accountSeq]);

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await fetchAdvisor(accountSeq);
      writeStoredResult(accountSeq, result);
      setState({ status: "loaded", result });
    } catch (error) {
      const notConfigured =
        error instanceof ApiClientError && error.code === "advisor-not-configured";
      setState({
        status: "error",
        notConfigured,
        message: notConfigured
          ? "AI 어드바이저가 설정되지 않았습니다."
          : "조언을 불러오지 못했습니다.",
      });
    }
  }, [accountSeq]);

  useEffect(() => {
    if (!autoEnabled) {
      return;
    }
    const id = window.setInterval(() => {
      void run();
    }, autoIntervalMs);
    return () => window.clearInterval(id);
  }, [autoEnabled, autoIntervalMs, run]);

  return (
    <CollapsibleCard title="AI 어드바이저" storageId="ai-advisor">
      <div className={styles.advisorBody}>
        <button
          type="button"
          className={styles.advisorRunButton}
          onClick={run}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "분석 중…" : "조언 받기"}
        </button>
        <AdvisorAutoControls
          enabled={autoEnabled}
          intervalMs={autoIntervalMs}
          onEnabledChange={setAutoEnabled}
          onIntervalChange={setAutoIntervalMs}
        />
        <p className={styles.advisorDisclaimer}>
          ※ AI 제안은 참고용입니다. 모든 주문은 직접 확인 후 §6 안전 게이트를 거쳐 실행됩니다.
        </p>

        {state.status === "error" && (
          <p className={styles.advisorError}>{state.message}</p>
        )}

        {state.status === "loaded" && (
          <div className={styles.advisorResult}>
            <p className={styles.advisorAdvice}>{state.result.advice}</p>
            {state.result.proposals.length > 0 && (
              <ul className={styles.advisorProposalList}>
                {state.result.proposals.map((item, index) => (
                  <ProposalRow
                    key={`${item.proposal.symbol}-${index}`}
                    item={item}
                    onSelect={onSelectProposal}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
