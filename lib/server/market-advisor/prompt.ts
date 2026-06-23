import "server-only";
import type { ChatMessage } from "@/lib/server/llm/types";
import type { MarketAdvisorRequest } from "./schema";

// Pure prompt builder: validated request -> system+user chat messages. Kept
// deterministic (no clock/network/randomness) so it is fully unit-tested. The
// structured-output JSON schema is enforced separately via the provider's
// response_format (schema.ts); here the analysis intent and guardrails are
// described in prose. Mirrors lib/server/advisor/prompt.ts.

const SYSTEM_PROMPT = [
  "당신은 한국어로 답하는 시세 차트 분석 어드바이저입니다.",
  "당신은 위험 감내도가 높은 적극적·공격적 매매 성향을 가집니다. 모멘텀과 단기 기회를 중시하고,",
  "관망(wait)보다 적극적인 매수/매도 판단을 우선 고려하되, 근거가 약하면 무리하지 마세요.",
  "공격적 매매는 빠른 진입뿐 아니라 빠른 청산(차익실현·손절)까지 포함합니다. 매도(sell)를 매수만큼",
  "적극적으로 제시하세요: 상승·과열·저항 도달·상승 둔화·고점 신호에서는 차익실현(sell)을, 하락 추세·",
  "지지선 붕괴·추세 전환에서는 관망(wait)에 머물지 말고 손절·회피(sell)를 검토하세요.",
  "'오르면 매수, 내리면 관망'으로만 치우치면 파는 시점이 사라지므로, 그런 편향을 피하고 매도 타이밍을 분명히 하세요.",
  "보유 정보(수량·평단가)가 주어지면 현재가와 평단가를 비교해 평단 대비 손익을 고려하고, 그 기준으로 차익실현·손절 판단을 구체화하세요.",
  "제공된 가격·캔들 데이터만 근거로 추세, 변동성, 지지/저항 가능성을 간결히 분석하세요.",
  "살지/팔지/보유할지/기다릴지에 대한 참고 판단을 decision에 담으세요: buy=매수 검토, sell=매도 검토, hold=보유 유지, wait=관망.",
  "decision은 실제 주문 지시가 아니라 사용자가 검토할 참고 판단입니다.",
  "차트에 그릴 지지선, 저항선, 캔들 마커도 함께 제시하세요.",
  "지지선/저항선 가격과 마커 timestamp는 반드시 제공된 캔들 데이터 범위 안에서 근거가 있어야 합니다.",
  "근거가 약한 annotation은 빈 배열로 두세요.",
  "실제 주문 실행이나 확정 표현은 하지 말고, 사용자가 검토할 관찰과 리스크만 제시하세요.",
  "응답은 지정된 JSON 스키마로만 작성하세요.",
].join("\n");

/**
 * Builds the system+user messages for one market advisor call. The user message
 * carries the symbol context and candle data as JSON so the model sees
 * structured, unambiguous input.
 */
export function buildMarketAdvisorPrompt(request: MarketAdvisorRequest): ChatMessage[] {
  const title = request.name ? `${request.name} (${request.symbol})` : request.symbol;
  const userLines = [
    `종목: ${title}`,
    `차트 주기: ${request.interval}`,
    `통화: ${request.currency}`,
    `현재가: ${request.lastPrice ?? "-"}`,
  ];
  if (request.position) {
    userLines.push(
      `보유: ${request.position.quantity}주, 평단가: ${request.position.averagePrice}`,
    );
  }
  userLines.push("캔들 데이터(JSON):", JSON.stringify(request.candles, null, 2));
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userLines.join("\n") },
  ];
}
