/**
 * Provider fallback chain.
 *
 * Ported from `bart-app/server/lib/orchestrator.js:691-730` (callWithFallback).
 * Bart's chain was Sonnet → GPT-4o → Gemini; ours is Sonnet 4.6 → Haiku 4.5 → Gemini 2.5.
 * GPT-4o is dropped from app-side use (we only call OpenAI for embeddings).
 */

import { callClaude, type ClaudeCallOptions, type ClaudeCallResult } from "@/lib/llm/anthropic";
import { callGemini } from "@/lib/llm/gemini";
import { isCircuitOpen } from "@/lib/llm/circuit-breaker";
import type { ModelKey } from "@/lib/llm/router";

const DEFAULT_CHAIN: ModelKey[] = ["sonnet46", "haiku45", "gemini25Flash"];

export interface FallbackOptions extends ClaudeCallOptions {
  /** Override the default chain (Bart equivalent: per-task override). */
  chain?: ModelKey[];
}

export interface FallbackResult {
  text: string;
  modelKey: ModelKey;
  attempts: Array<{ modelKey: ModelKey; ok: boolean; error?: string }>;
}

/**
 * Try each provider in `chain` until one succeeds. Skips providers whose circuit is open.
 */
export async function callWithFallback(opts: FallbackOptions): Promise<FallbackResult> {
  const chain = opts.chain ?? DEFAULT_CHAIN;
  const attempts: FallbackResult["attempts"] = [];

  for (const modelKey of chain) {
    if (isCircuitOpen(modelKey)) {
      attempts.push({ modelKey, ok: false, error: "circuit_open" });
      continue;
    }
    try {
      if (modelKey === "gemini25Flash") {
        const r = await callGemini({
          modelKey,
          prompt: opts.prompt ?? "",
          system: opts.system,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          costTracker: opts.costTracker,
          purpose: opts.purpose,
          signal: opts.signal,
        });
        attempts.push({ modelKey, ok: true });
        return { text: r.text, modelKey, attempts };
      }
      const r: ClaudeCallResult = await callClaude({ ...opts, modelKey });
      attempts.push({ modelKey, ok: true });
      return { text: r.text, modelKey, attempts };
    } catch (err) {
      attempts.push({
        modelKey,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  throw new Error(
    `All providers in fallback chain failed: ${attempts
      .map((a) => `${a.modelKey}=${a.error ?? "ok"}`)
      .join("; ")}`,
  );
}
