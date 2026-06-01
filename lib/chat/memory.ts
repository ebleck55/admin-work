/**
 * Memory facts — durable things to remember about Eric, the business, prior
 * decisions, ongoing context. Embedded with Gemini's gemini-embedding-001
 * (1536 dims via MRL — matches existing pgvector cols) so retrieval can use
 * the same HNSW infrastructure as the evidence ledger.
 *
 * Used by the chat stream to inject relevant facts into each assistant turn.
 */

import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { embed } from "@/lib/llm/embeddings";
import type { Sensitivity } from "@/lib/ingestion/envelope";

export type MemoryKind = "preference" | "entity_fact" | "decision" | "context";

export interface MemoryFact {
  id: string;
  kind: MemoryKind;
  text: string;
  weight: number;
  sensitivity: Sensitivity;
  createdAt: Date;
  lastReferencedAt: Date | null;
  distance?: number;
}

/**
 * Persist a new memory fact. Embeds the text via Gemini and writes to memory_facts.
 */
export async function addMemoryFact(opts: {
  kind: MemoryKind;
  text: string;
  weight?: number;
  sourceMessageId?: string;
  sourceConversationId?: string;
  sensitivity?: Sensitivity;
}): Promise<MemoryFact> {
  const [vector] = await embed([opts.text]);
  const inserted = await db()
    .insert(schema.memoryFacts)
    .values({
      kind: opts.kind,
      text: opts.text,
      embedding: vector,
      weight: opts.weight ?? 1.0,
      sourceMessageId: opts.sourceMessageId ?? null,
      sourceConversationId: opts.sourceConversationId ?? null,
      sensitivity: opts.sensitivity ?? "internal",
    })
    .returning({
      id: schema.memoryFacts.id,
      kind: schema.memoryFacts.kind,
      text: schema.memoryFacts.text,
      weight: schema.memoryFacts.weight,
      sensitivity: schema.memoryFacts.sensitivity,
      createdAt: schema.memoryFacts.createdAt,
      lastReferencedAt: schema.memoryFacts.lastReferencedAt,
    });
  return inserted[0];
}

export async function listAllMemoryFacts(): Promise<MemoryFact[]> {
  return db()
    .select({
      id: schema.memoryFacts.id,
      kind: schema.memoryFacts.kind,
      text: schema.memoryFacts.text,
      weight: schema.memoryFacts.weight,
      sensitivity: schema.memoryFacts.sensitivity,
      createdAt: schema.memoryFacts.createdAt,
      lastReferencedAt: schema.memoryFacts.lastReferencedAt,
    })
    .from(schema.memoryFacts)
    .orderBy(desc(schema.memoryFacts.createdAt))
    .limit(200);
}

/**
 * Retrieve memory facts relevant to a query via embedding similarity.
 */
export async function retrieveMemoryFacts(
  query: string,
  opts: { limit?: number; includePrivateDm?: boolean } = {},
): Promise<MemoryFact[]> {
  const limit = opts.limit ?? 6;
  if (!query.trim()) return [];

  const [vector] = await embed([query]);
  const literal = `[${vector.join(",")}]`;

  const allowed = opts.includePrivateDm
    ? ["public", "internal", "private_dm"]
    : ["public", "internal"];

  const rows = await db().execute(sql`
    SELECT
      id,
      kind,
      text,
      weight,
      sensitivity,
      created_at,
      last_referenced_at,
      embedding <=> ${sql.raw(`'${literal}'::vector`)} AS distance
    FROM ${schema.memoryFacts}
    WHERE sensitivity IN (${sql.join(
      allowed.map((s) => sql`${s}`),
      sql`, `,
    )})
      AND embedding IS NOT NULL
    ORDER BY (embedding <=> ${sql.raw(`'${literal}'::vector`)}) / GREATEST(weight, 0.1) ASC
    LIMIT ${limit}
  `);

  const hits = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: r.kind as MemoryKind,
    text: String(r.text),
    weight: Number(r.weight),
    sensitivity: r.sensitivity as Sensitivity,
    createdAt: new Date(r.created_at as string),
    lastReferencedAt: r.last_referenced_at ? new Date(r.last_referenced_at as string) : null,
    distance: Number(r.distance),
  }));

  // Bump last_referenced_at on retrieved facts (best-effort, fire and forget)
  if (hits.length > 0) {
    const ids = hits.map((h) => h.id);
    void db()
      .update(schema.memoryFacts)
      .set({ lastReferencedAt: new Date() })
      .where(sql`id = ANY(${ids}::uuid[])`)
      .catch(() => {});
  }

  return hits;
}

export async function deleteMemoryFact(id: string): Promise<void> {
  await db().delete(schema.memoryFacts).where(eq(schema.memoryFacts.id, id));
}
