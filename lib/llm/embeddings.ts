/**
 * Embedding generation via OpenAI text-embedding-3-small (1536 dimensions).
 *
 * Net-new for COS (audit row 15). Bart has no embeddings; learning apps don't either.
 * We keep the wrapper thin: batched calls, retry on transient errors, cost tracking.
 */

import OpenAI from "openai";

import { env } from "@/lib/env";
import { recordGlobalUsage, type CostTracker } from "@/lib/llm/cost-tracker";

const MODEL_KEY = "embedSmall" as const;
const MODEL_ID = "text-embedding-3-small";
const DIMENSIONS = 1536;

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (client) return client;
  client = new OpenAI({ apiKey: env().OPENAI_API_KEY });
  return client;
}

export interface EmbeddingOptions {
  costTracker?: CostTracker;
  signal?: AbortSignal;
}

/**
 * Generate embeddings for one or more strings. Returns vectors in the same order.
 */
export async function embed(
  inputs: string[],
  opts: EmbeddingOptions = {},
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const response = await openai().embeddings.create(
    {
      model: MODEL_ID,
      input: inputs,
      dimensions: DIMENSIONS,
    },
    { signal: opts.signal },
  );
  const usage = {
    modelKey: MODEL_KEY,
    inputTokens: response.usage.prompt_tokens,
    outputTokens: 0,
  };
  if (opts.costTracker) opts.costTracker.record(usage);
  else recordGlobalUsage(usage);
  return response.data.map((d) => d.embedding);
}

/**
 * Chunk a long string into ~800-token windows with 100-token overlap.
 * Approximated by character count (rough heuristic: 4 chars ≈ 1 token).
 */
export function chunkText(text: string, opts: { maxChars?: number; overlap?: number } = {}): string[] {
  const maxChars = opts.maxChars ?? 3200;
  const overlap = opts.overlap ?? 400;
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}
