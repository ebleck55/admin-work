/**
 * Gemini SDK wrapper.
 *
 * Ported from `bart-app/server/lib/orchestrator.js:596-649` (callGemini). Bart uses raw
 * https; we use `@google/generative-ai`. Keeps the `systemInstruction` shape.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/env";
import { MODELS, type ModelKey } from "@/lib/llm/router";
import { recordResult } from "@/lib/llm/circuit-breaker";
import { recordGlobalUsage, type CostTracker } from "@/lib/llm/cost-tracker";

let cachedClient: GoogleGenerativeAI | null = null;
function client(): GoogleGenerativeAI {
  if (cachedClient) return cachedClient;
  const key = env().GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  cachedClient = new GoogleGenerativeAI(key);
  return cachedClient;
}

export interface GeminiCallOptions {
  modelKey?: ModelKey;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  costTracker?: CostTracker;
  purpose?: string;
  signal?: AbortSignal;
}

export interface GeminiCallResult {
  text: string;
  modelKey: ModelKey;
  usage: { inputTokens: number; outputTokens: number };
}

export async function callGemini(opts: GeminiCallOptions): Promise<GeminiCallResult> {
  const modelKey = opts.modelKey ?? "gemini25Flash";
  const cfg = MODELS[modelKey];
  const model = client().getGenerativeModel({
    model: cfg.id,
    systemInstruction: opts.system,
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? cfg.maxOutputTokens,
      temperature: opts.temperature,
    },
  });

  const start = Date.now();
  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    });
    const text = result.response.text();
    const usage = {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
    };
    recordResult(modelKey, { success: true, durationMs: Date.now() - start });
    const usageRecord = { modelKey, ...usage };
    if (opts.costTracker) opts.costTracker.record(usageRecord);
    else recordGlobalUsage(usageRecord);
    return { text, modelKey, usage };
  } catch (err) {
    recordResult(modelKey, { success: false, durationMs: Date.now() - start });
    throw err;
  }
}
