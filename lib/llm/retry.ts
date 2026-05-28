/**
 * Typed Claude call with retry-on-parse-failure plus shared JSON-response sanitization.
 *
 * Ported from Learning Quest:
 *   - K-2/K-5 `lib/api.ts callClaudeWithRetry<T>()` — returns parsed `T`, retries up to N times
 *     on JSON parse failure with a 30s timeout per attempt.
 *   - K-2/K-5 `lib/api.ts parseJsonResponse<T>()` — strips markdown fences, normalizes smart
 *     quotes, extracts the first {...} block.
 *
 * Differences:
 *   - We use the official Anthropic SDK (Bart uses raw https; Learning Quest uses fetch).
 *   - We accept any zod schema for runtime shape validation, not just a TS generic.
 */

import type { z } from "zod";
import { callClaude, type ClaudeCallOptions } from "@/lib/llm/anthropic";

const DEFAULT_MAX_RETRIES = 2;

export function parseJson<T = unknown>(text: string): T {
  let cleaned = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences (Learning Quest pattern)
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // Smart-quote → straight-quote normalization (Learning Quest pattern)
  cleaned = cleaned.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Extract the first {...} or [...] if surrounding prose is present
  const firstBrace = cleaned.search(/[\[{]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (lastBrace > 0 && lastBrace < cleaned.length - 1) cleaned = cleaned.slice(0, lastBrace + 1);
  return JSON.parse(cleaned) as T;
}

export interface CallClaudeWithRetryOptions<T> extends ClaudeCallOptions {
  /** Zod schema for the parsed JSON. If omitted, only structural parsing happens. */
  schema?: z.ZodType<T>;
  /** Max retries on JSON parse failure (default 2). */
  maxRetries?: number;
}

/**
 * Call Claude expecting a JSON response, with parse-failure retries.
 * Returns the parsed (and optionally schema-validated) `T`.
 */
export async function callClaudeWithRetry<T>(
  opts: CallClaudeWithRetryOptions<T>,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { text } = await callClaude(opts);
      const parsed = parseJson(text);
      if (opts.schema) return opts.schema.parse(parsed);
      return parsed as T;
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
    }
  }
  throw new Error(
    `callClaudeWithRetry: failed after ${maxRetries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
