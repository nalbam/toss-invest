import { z } from "zod";
import { NextResponse } from "next/server";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { recordMarketAdvice } from "@/lib/server/cache/market-history";
import { getServerLlmProvider, LlmNotConfiguredError } from "@/lib/server/llm/container";
import type { ChatMessage } from "@/lib/server/llm/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

const candleSchema = z.object({
  timestamp: z.string(),
  openPrice: z.string(),
  highPrice: z.string(),
  lowPrice: z.string(),
  closePrice: z.string(),
  volume: z.string(),
  currency: z.string(),
});

const bodySchema = z.object({
  symbol: z.string().regex(symbolPattern),
  name: z.string().min(1).optional(),
  interval: z.string().min(1),
  currency: z.string().min(1),
  lastPrice: z.string().optional(),
  candles: z.array(candleSchema).max(300),
});

const annotationLevelSchema = z.object({
  price: z.number(),
  label: z.string().min(1),
});

const marketAdvisorResultSchema = z.object({
  advice: z.string().min(1),
  decision: z.object({
    action: z.enum(["buy", "sell", "hold", "wait"]),
    label: z.string().min(1),
    reason: z.string().min(1),
  }),
  annotations: z.object({
    supportLevels: z.array(annotationLevelSchema).max(5),
    resistanceLevels: z.array(annotationLevelSchema).max(5),
    markers: z.array(
      z.object({
        timestamp: z.string().min(1),
        position: z.enum(["aboveBar", "belowBar", "inBar"]),
        label: z.string().min(1),
      }),
    ).max(8),
  }),
});

const marketAdvisorJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["advice", "decision", "annotations"],
  properties: {
    advice: { type: "string" },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["action", "label", "reason"],
      properties: {
        action: { type: "string", enum: ["buy", "sell", "hold", "wait"] },
        label: { type: "string" },
        reason: { type: "string" },
      },
    },
    annotations: {
      type: "object",
      additionalProperties: false,
      required: ["supportLevels", "resistanceLevels", "markers"],
      properties: {
        supportLevels: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["price", "label"],
            properties: {
              price: { type: "number" },
              label: { type: "string" },
            },
          },
        },
        resistanceLevels: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["price", "label"],
            properties: {
              price: { type: "number" },
              label: { type: "string" },
            },
          },
        },
        markers: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["timestamp", "position", "label"],
            properties: {
              timestamp: { type: "string" },
              position: { type: "string", enum: ["aboveBar", "belowBar", "inBar"] },
              label: { type: "string" },
            },
          },
        },
      },
    },
  },
};

function buildMarketAdvisorPrompt(input: z.infer<typeof bodySchema>): ChatMessage[] {
  const title = input.name ? `${input.name} (${input.symbol})` : input.symbol;
  return [
    {
      role: "system",
      content: [
        "당신은 한국어로 답하는 시세 차트 분석 어드바이저입니다.",
        "제공된 가격·캔들 데이터만 근거로 추세, 변동성, 지지/저항 가능성을 간결히 분석하세요.",
        "살지/팔지/보유할지/기다릴지에 대한 참고 판단을 decision에 담으세요: buy=매수 검토, sell=매도 검토, hold=보유 유지, wait=관망.",
        "decision은 실제 주문 지시가 아니라 사용자가 검토할 참고 판단입니다.",
        "차트에 그릴 지지선, 저항선, 캔들 마커도 함께 제시하세요.",
        "지지선/저항선 가격과 마커 timestamp는 반드시 제공된 캔들 데이터 범위 안에서 근거가 있어야 합니다.",
        "근거가 약한 annotation은 빈 배열로 두세요.",
        "실제 주문 실행이나 확정 표현은 하지 말고, 사용자가 검토할 관찰과 리스크만 제시하세요.",
        "응답은 지정된 JSON 스키마로만 작성하세요.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `종목: ${title}`,
        `차트 주기: ${input.interval}`,
        `통화: ${input.currency}`,
        `현재가: ${input.lastPrice ?? "-"}`,
        "캔들 데이터(JSON):",
        JSON.stringify(input.candles, null, 2),
      ].join("\n"),
    },
  ];
}

function timestampMs(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return trimmed.length >= 13 ? num : num * 1000;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

function latestCandleTimestamp(input: z.infer<typeof bodySchema>): string | null {
  let latest: { timestamp: string; ms: number } | null = null;
  for (const candle of input.candles) {
    const ms = timestampMs(candle.timestamp);
    if (ms === null) {
      continue;
    }
    if (latest === null || ms > latest.ms) {
      latest = { timestamp: candle.timestamp, ms };
    }
  }
  return latest?.timestamp ?? null;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid market advisor request body");
  }

  try {
    const provider = getServerLlmProvider();
    const response = await provider.chat({
      messages: buildMarketAdvisorPrompt(parsed.data),
      jsonSchema: { name: "market_advice", schema: marketAdvisorJsonSchema },
    });
    const content: unknown = JSON.parse(response.content);
    const result = marketAdvisorResultSchema.parse(content);
    const generatedAt = new Date().toISOString();
    void recordMarketAdvice({
      symbol: parsed.data.symbol,
      interval: parsed.data.interval,
      generatedAt,
      chartTimestamp: latestCandleTimestamp(parsed.data),
      lastPrice: parsed.data.lastPrice,
      decision: result.decision,
      advice: result.advice.trim(),
    });

    return ok({
      advice: result.advice.trim(),
      decision: result.decision,
      annotations: result.annotations,
      model: response.model,
      generatedAt,
    });
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return NextResponse.json(
        { error: { code: "advisor-not-configured", message: "AI advisor is not configured" } },
        { status: 503 },
      );
    }
    if (error instanceof Error && error.message.includes("chat request failed")) {
      return NextResponse.json(
        { error: { code: "market-advisor-failed", message: "AI market advisor request failed" } },
        { status: 502 },
      );
    }
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "market-advisor-response-invalid", message: "AI market advisor response is invalid" } },
        { status: 502 },
      );
    }
    return handleError(error);
  }
}
