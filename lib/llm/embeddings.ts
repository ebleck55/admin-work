/**
 * Embedding generation via Google's gemini-embedding-001 (1536 dimensions via MRL).
 *
 * Originally `text-embedding-3-small` from OpenAI; swapped to Gemini in May 2026 when
 * Eric's account lacked OpenAI access. Matryoshka Representation Learning lets us
 * truncate to 1536 dims to match the existing pgvector column without a schema change.
 *
 * Gemini embeddings are unit-normalized, so cosine distance over them is equivalent
 * to Euclidean — the schema's HNSW vector_cosine_ops index works unchanged.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/env";
import { recordGlobalUsage, type CostTracker } from "@/lib/llm/cost-tracker";

const MODEL_KEY = "geminiEmbed" as const;
const MODEL_ID = "gemini-embedding-001";
const DIMENSIONS = 1536;

let client: GoogleGenerativeAI | null = null;
function googleClient(): GoogleGenerativeAI {
  if (client) return client;
  const key = env().GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY required for embeddings");
  client = new GoogleGenerativeAI(key);
  return client;
}

export interface EmbeddingOptions {
  costTracker?: CostTracker;
  signal?: AbortSignal;
}

/**
 * Generate embeddings for one or more strings. Returns vectors in the same order.
 * Token usage is approximated from input character length (Gemini's batch API
 * doesn't return per-request token counts; ~4 chars ≈ 1 token).
 */
export async function embed(
  inputs: string[],
  opts: EmbeddingOptions = {},
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  void opts.signal; // SDK doesn't accept AbortSignal; documented limitation

  const model = googleClient().getGenerativeModel({ model: MODEL_ID });

  const response = await model.batchEmbedContents({
    requests: inputs.map((text) => ({
      content: { role: "user", parts: [{ text }] },
      outputDimensionality: DIMENSIONS,
    })),
  });

  const approxTokens = Math.ceil(
    inputs.reduce((sum, t) => sum + t.length, 0) / 4,
  );
  const usage = {
    modelKey: MODEL_KEY,
    inputTokens: approxTokens,
    outputTokens: 0,
  };
  if (opts.costTracker) opts.costTracker.record(usage);
  else recordGlobalUsage(usage);

  return response.embeddings.map((e) => e.values);
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
