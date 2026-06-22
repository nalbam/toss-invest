import { z } from "zod";
import { NextResponse } from "next/server";
import { handleError, invalidRequest, ok } from "@/lib/server/api/respond";
import { getServerLlmProvider, LlmNotConfiguredError } from "@/lib/server/llm/container";
import type { ChatMessage } from "@/lib/server/llm/types";

export const dynamic = "force-dynamic";

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

function buildMarketAdvisorPrompt(input: z.infer<typeof bodySchema>): ChatMessage[] {
  const title = input.name ? `${input.name} (${input.symbol})` : input.symbol;
  return [
    {
      role: "system",
      content: [
        "당신은 한국어로 답하는 시세 차트 분석 어드바이저입니다.",
        "제공된 가격·캔들 데이터만 근거로 추세, 변동성, 지지/저항 가능성을 간결히 분석하세요.",
        "실제 주문 실행이나 확정 표현은 하지 말고, 사용자가 검토할 관찰과 리스크만 제시하세요.",
        "응답은 한국어 일반 텍스트로 작성하세요.",
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
    });

    return ok({
      advice: response.content.trim(),
      model: response.model,
      generatedAt: new Date().toISOString(),
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
    return handleError(error);
  }
}
