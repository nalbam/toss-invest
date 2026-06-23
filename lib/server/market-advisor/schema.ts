import "server-only";
import { z } from "zod";

// Input + structured-output contract for the market (chart) advisor. The request
// is validated at the route boundary; the provider response is an untrusted
// boundary re-parsed with `marketAdvisorResultSchema` before use (extra/
// hallucinated fields are stripped). Mirrors lib/server/advisor/schema.ts.

const symbolPattern = /^[A-Za-z0-9.\-]+$/;

export const candleSchema = z.object({
  timestamp: z.string(),
  openPrice: z.string(),
  highPrice: z.string(),
  lowPrice: z.string(),
  closePrice: z.string(),
  volume: z.string(),
  currency: z.string(),
});

export const marketAdvisorRequestSchema = z.object({
  symbol: z.string().regex(symbolPattern),
  name: z.string().min(1).optional(),
  interval: z.string().min(1),
  currency: z.string().min(1),
  lastPrice: z.string().optional(),
  candles: z.array(candleSchema).max(300),
  // Present only for held symbols, so the advisor can judge profit-taking/
  // stop-loss against the user's actual average price, not just the chart.
  position: z
    .object({
      quantity: z.string(),
      averagePrice: z.string(),
    })
    .optional(),
});

const annotationLevelSchema = z.object({
  price: z.number(),
  label: z.string().min(1),
});

export const marketAdvisorResultSchema = z.object({
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

// Provider-native structured output mirroring marketAdvisorResultSchema. Improves
// the LLM's odds of returning well-formed JSON; the response is still re-parsed
// with the zod schema in runMarketAdvisor, so this is reliability help, not a
// trust anchor.
export const marketAdvisorJsonSchema = {
  name: "market_advice",
  schema: {
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
  },
} as const;

export type MarketAdvisorRequest = z.infer<typeof marketAdvisorRequestSchema>;
export type MarketAdvisorResult = z.infer<typeof marketAdvisorResultSchema>;
