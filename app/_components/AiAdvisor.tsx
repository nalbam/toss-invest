"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/client/hooks";
import {
  fetchAdvisor,
  type AdvisorProposal,
  type AdvisorResult,
  type ValidatedProposal,
} from "@/lib/client/advisor";
import { AdvisorAutoControls } from "./AdvisorAutoControls";
import { CollapsibleCard } from "./CollapsibleCard";
import styles from "./dashboard.module.css";
import { readStoredJson, writeStoredJson } from "./localStorageJson";
import { useAdvisorAutoRerun } from "./useAdvisorAutoRerun";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: AdvisorResult }
  | { status: "error"; message: string; notConfigured: boolean };

const ADVISOR_RESULT_KEY = "toss-invest:ai-advisor-result";
const ADVISOR_AUTO_KEY = "toss-invest:ai-advisor-auto";

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

function isValidatedProposal(item: unknown): item is ValidatedProposal {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const candidate = item as Partial<ValidatedProposal>;
  const proposal = candidate.proposal as AdvisorProposal | undefined;
  return (
    typeof candidate.valid === "boolean" &&
    Array.isArray(candidate.reasons) &&
    typeof proposal === "object" &&
    proposal !== null &&
    (proposal.kind === "buy" ||
      proposal.kind === "trim" ||
      proposal.kind === "exit" ||
      proposal.kind === "rebalance") &&
    typeof proposal.symbol === "string" &&
    (proposal.side === "BUY" || proposal.side === "SELL") &&
    typeof proposal.quantity === "number" &&
    typeof proposal.rationale === "string"
  );
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
    Array.isArray(result.proposals) &&
    result.proposals.every(isValidatedProposal)
  );
}

function ProposalRow({
  item,
  onSelect,
}: {
  item: ValidatedProposal;
  onSelect?: (proposal: AdvisorProposal, name?: string) => void;
}) {
  const { proposal, valid, reasons, name } = item;
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
          onClick={() => onSelect?.(proposal, name)}
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
  onSelectProposal?: (proposal: AdvisorProposal, name?: string) => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const requestSeqRef = useRef(0);

  useEffect(() => {
    requestSeqRef.current += 1;
    const stored = readStoredJson(storageKey(accountSeq), isAdvisorResult);
    setState(stored ? { status: "loaded", result: stored } : { status: "idle" });
  }, [accountSeq]);

  const run = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setState({ status: "loading" });
    try {
      const result = await fetchAdvisor(accountSeq);
      if (seq !== requestSeqRef.current) return;
      writeStoredJson(storageKey(accountSeq), result);
      setState({ status: "loaded", result });
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
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
  const {
    autoEnabled,
    autoIntervalMs,
    autoRemainingRatio,
    setAutoEnabled,
    setAutoIntervalMs,
  } = useAdvisorAutoRerun(run, ADVISOR_AUTO_KEY);

  return (
    <CollapsibleCard title="AI 어드바이저" storageId="ai-advisor">
      <div className={styles.advisorBody}>
        <div className={styles.advisorActionRow}>
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
            remainingRatio={autoRemainingRatio}
            onEnabledChange={setAutoEnabled}
            onIntervalChange={setAutoIntervalMs}
          />
        </div>
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
