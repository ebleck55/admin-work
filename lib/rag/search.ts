/**
 * RAG retrieval with sensitivity gating.
 *
 * Day 1: nearest-neighbor over `embeddings` table via pgvector cosine distance,
 * filtered by sensitivity according to the caller's eligibility. private_dm
 * chunks never leak into a query whose caller has shareable=true.
 */

import { sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { embed } from "@/lib/llm/embeddings";
import type { Sensitivity } from "@/lib/ingestion/envelope";

export interface RagHit {
  embeddingId: string;
  documentId: string;
  chunkText: string;
  chunkIndex: number;
  distance: number;
  sensitivity: Sensitivity;
  documentTitle: string;
  documentLedgerId: string;
}

export interface RagOptions {
  /** Limit results. */
  limit?: number;
  /** Maximum cosine distance. */
  maxDistance?: number;
  /** Include private_dm? (default: false — shareable artifacts opt out.) */
  includePrivateDm?: boolean;
}

/**
 * Embed the query string and return the nearest chunks. Each hit is annotated with
 * its sensitivity so the caller can cite + gate downstream.
 */
export async function searchEvidence(
  query: string,
  opts: RagOptions = {},
): Promise<RagHit[]> {
  const limit = opts.limit ?? 8;
  const maxDistance = opts.maxDistance ?? 0.7;
  const includePrivateDm = opts.includePrivateDm ?? false;

  const [vector] = await embed([query]);
  const vectorLiteral = `[${vector.join(",")}]`;

  // Sensitivity filter values
  const allowedSensitivities = includePrivateDm
    ? ["public", "internal", "private_dm"]
    : ["public", "internal"];

  const rows = await db().execute(sql`
    SELECT
      e.id          AS embedding_id,
      e.document_id AS document_id,
      e.chunk_text  AS chunk_text,
      e.chunk_index AS chunk_index,
      e.sensitivity AS sensitivity,
      e.embedding <=> ${sql.raw(`'${vectorLiteral}'::vector`)} AS distance,
      d.title       AS document_title,
      d.ledger_id   AS document_ledger_id
    FROM ${schema.embeddings} e
    JOIN ${schema.documents}  d ON d.id = e.document_id
    WHERE e.sensitivity IN (${sql.join(
      allowedSensitivities.map((s) => sql`${s}`),
      sql`, `,
    )})
    AND e.embedding <=> ${sql.raw(`'${vectorLiteral}'::vector`)} < ${maxDistance}
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    embeddingId: String(r.embedding_id),
    documentId: String(r.document_id),
    chunkText: String(r.chunk_text),
    chunkIndex: Number(r.chunk_index),
    distance: Number(r.distance),
    sensitivity: r.sensitivity as Sensitivity,
    documentTitle: String(r.document_title),
    documentLedgerId: String(r.document_ledger_id),
  }));
}
