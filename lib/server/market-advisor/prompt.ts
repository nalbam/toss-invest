import "server-only";
import {
  computeIndicators,
  type Indicators,
  type TrendSummary,
} from "@/lib/client/indicators";
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
  "적극성은 한 방향이 아니라 매수와 매도 양쪽에 균형 있게 적용합니다. 매수 신호와 매도 신호를 같은 기준으로",
  "판단하고, 어느 한쪽으로 치우치지 말고 신호가 가리키는 방향을 따르세요.",
  "제공된 가격·캔들 데이터와 함께 계산된 기술지표(이동평균·RSI·고저·거래량·변동성)를 근거로 추세, 변동성, 지지/저항 가능성을 간결히 분석하세요.",
  "살지/팔지/보유할지/기다릴지에 대한 참고 판단을 decision에 담으세요: buy=매수 검토, sell=매도 검토, hold=보유 유지, wait=관망.",
  "다음 신호를 근거로 방향을 정하세요.",
  "매수(buy) 신호: 강한 지지선에서의 반등 확인, 상승추세 내 눌림목(되돌림 후 지지), 박스권 하단 지지, 과매도 반등, 저항 돌파(breakout, 거래량 동반), 하락에서 상승으로의 추세 전환.",
  "매도(sell) 신호: 저항 도달 또는 돌파 실패, 과매수·과열, 상승 둔화·고점 신호, 지지선 붕괴, 상승에서 하락으로의 추세 전환, (보유 시) 목표가 도달 차익실현 또는 추세 이탈 손절.",
  "보유(hold): 추세가 유지되는 가운데 신규 진입이나 청산의 근거가 약하지만 현재 포지션 유지가 합리적일 때.",
  "관망(wait): 매수와 매도 근거가 모두 약하거나 신호가 혼재할 때. 단 신호가 분명한데도 습관적으로 관망에 머물지는 마세요.",
  "상위 시간대(예: 일봉) 추세가 함께 주어지면 다중 시간대로 판단하세요: 분봉이 눌림목·과매도여도 상위 추세가 상승이면 매수(buy) 후보로 보고, 상위 추세가 하락이면 분봉 반등은 차익실현·반등 매도(sell)를 우선 고려하세요. 상위 추세가 횡보(flat)면 분봉 신호를 그대로 따르세요.",
  "보유 정보(수량·평단가)가 주어지면 현재가와 평단가를 비교하되, 평가손익을 양방향으로 대칭 처리하세요.",
  "평가손실이어도 강한 지지와 반등 신호가 있으면 보유 유지 또는 추가 매수(buy) 후보로, 평가수익이어도 과열·저항 신호가 있으면 차익실현(sell)으로 판단하세요. '손실=무조건 손절, 수익=무조건 보유'처럼 평가손익만으로 방향을 정하지 마세요.",
  "차트에 그릴 지지선, 저항선, 캔들 마커도 함께 제시하세요.",
  "지지선/저항선 가격과 마커 timestamp는 반드시 제공된 캔들 데이터 범위 안에서 근거가 있어야 합니다.",
  "근거가 약한 annotation은 빈 배열로 두세요.",
  "decision은 실제 주문 지시가 아니라 사용자가 검토할 참고 판단입니다.",
  "실제 주문 실행이나 확정 표현은 하지 말고, 사용자가 검토할 관찰과 리스크만 제시하세요.",
  "응답은 지정된 JSON 스키마로만 작성하세요.",
].join("\n");

/**
 * Renders the computed technical indicators as a structured, labelled numeric
 * block so the model reads pre-calculated numbers rather than eyeballing raw
 * candles. Returns an empty array when nothing could be computed.
 */
function indicatorLines(indicators: Indicators): string[] {
  const lines: string[] = [];
  if (indicators.movingAverages.length > 0) {
    const parts = indicators.movingAverages.map(
      (ma) => `MA${ma.period}=${ma.value}(현재가 ${ma.diffPct >= 0 ? "+" : ""}${ma.diffPct}%)`,
    );
    lines.push(`- 이동평균: ${parts.join(", ")}`);
  }
  if (indicators.rsi14 !== undefined) {
    lines.push(`- RSI(14): ${indicators.rsi14}`);
  }
  if (indicators.recentHigh !== undefined && indicators.recentLow !== undefined) {
    lines.push(
      `- 최근 ${indicators.recentBars}봉 고가/저가: 고가=${indicators.recentHigh}, 저가=${indicators.recentLow}`,
    );
  }
  if (indicators.volume) {
    const { recentAverage, overallAverage, ratio, trend } = indicators.volume;
    const label = trend === "rising" ? "증가" : trend === "falling" ? "감소" : "보합";
    lines.push(
      `- 거래량: 최근 평균=${recentAverage}, 전체 평균=${overallAverage} (비율 ${ratio}, ${label})`,
    );
  }
  if (indicators.volatility) {
    const parts: string[] = [];
    if (indicators.volatility.atr14 !== undefined) {
      parts.push(`ATR(14)=${indicators.volatility.atr14}`);
    }
    if (indicators.volatility.recentRangePct !== undefined) {
      parts.push(`최근 레인지=${indicators.volatility.recentRangePct}%`);
    }
    if (parts.length > 0) {
      lines.push(`- 변동성: ${parts.join(", ")}`);
    }
  }
  return lines.length > 0 ? ["기술지표(계산값):", ...lines] : [];
}

/**
 * Renders the higher-timeframe trend summary as a single context line so the
 * model can weigh the lower-timeframe signal against the larger trend.
 */
function higherTimeframeLines(trend: TrendSummary): string[] {
  const direction =
    trend.direction === "up" ? "상승" : trend.direction === "down" ? "하락" : "횡보";
  const parts = [`방향=${direction}`, `현재가=${trend.lastPrice}`];
  for (const ma of trend.movingAverages) {
    parts.push(`MA${ma.period}=${ma.value}(${ma.position === "above" ? "위" : "아래"})`);
  }
  parts.push(`최근 고가/저가: 고가=${trend.recentHigh}, 저가=${trend.recentLow}`);
  return [`상위 추세(${trend.interval} 기준): ${parts.join(", ")}`];
}

/**
 * Builds the system+user messages for one market advisor call. The user message
 * carries the symbol context, computed technical indicators, and candle data as
 * JSON so the model sees structured, unambiguous input.
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
  userLines.push(...indicatorLines(computeIndicators(request.candles)));
  if (request.higherTimeframeTrend) {
    userLines.push(...higherTimeframeLines(request.higherTimeframeTrend));
  }
  userLines.push("캔들 데이터(JSON):", JSON.stringify(request.candles, null, 2));
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userLines.join("\n") },
  ];
}
