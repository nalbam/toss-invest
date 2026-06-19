import "server-only";
import type { ChatMessage } from "@/lib/server/llm/types";
import type { AdvisorSnapshot } from "./snapshot";

// Pure prompt builder: masked snapshot -> system+user chat messages. Kept
// deterministic (no clock/network/randomness) so it is fully unit-tested. The
// structured-output JSON schema is enforced separately via the provider's
// response_format (advisor.ts); here we describe the proposal fields in prose
// and state the safety guardrail so the model stays a proposer, not an executor.

const SYSTEM_PROMPT = [
  "당신은 한 개인 투자자의 포트폴리오를 분석하는 한국어 투자 어드바이저입니다.",
  "당신은 '제안자'일 뿐 '집행자'가 아닙니다. 당신의 출력은 제안이며, 실제 주문은",
  "사람이 직접 검토·확인한 뒤에만 체결됩니다. 절대 주문을 실행하거나 확정하지 마세요.",
  "",
  "두 가지를 한국어로 생성하세요:",
  "1) advice: 포트폴리오 상태에 대한 간결한 서술형 조언.",
  "2) proposals: 실행 가능한 제안 목록. 각 제안은 다음 필드를 가집니다 —",
  "   - kind: buy | trim | exit | rebalance",
  "   - symbol: 종목 코드",
  "   - side: BUY | SELL (buy=BUY, trim/exit=SELL)",
  "   - quantity: 양의 정수 수량",
  "   - rationale: 그 제안의 근거",
  "",
  "규칙: SELL 제안은 보유 수량(매도가능수량) 이내여야 합니다. 보유하지 않은 종목은",
  "매도할 수 없습니다. 보유 종목 관리(hold/trim/exit/리밸런싱)와 신규 매수(BUY)를 모두",
  "제안할 수 있으나, 단순 보유(hold) 권고는 proposals가 아니라 advice 서술에 담으세요.",
].join("\n");

/**
 * Builds the system+user messages for one advisor call. The user message carries
 * the masked snapshot (already PII-free) as JSON so the model sees structured,
 * unambiguous data.
 */
export function buildAdvisorPrompt(snapshot: AdvisorSnapshot): ChatMessage[] {
  const user = [
    "다음은 내 포트폴리오 스냅샷(JSON)입니다. 이를 바탕으로 조언과 제안을 생성하세요.",
    "",
    JSON.stringify(snapshot, null, 2),
  ].join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
