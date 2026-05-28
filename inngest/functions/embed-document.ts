/**
 * Embed a document into pgvector. Triggered after process-payload finishes
 * (via the same ingestion event — they fan out in parallel; embedding doesn't
 * block signal detection).
 *
 * Idempotent: if embeddings already exist for the document, skip.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { chunkText, embed } from "@/lib/llm/embeddings";

export const embedDocument = inngest.createFunction(
  { id: "embed-document", retries: 3, concurrency: { limit: 4 } },
  { event: "ingestion/payload.received" },
  async ({ event, step }) => {
    const { documentId } = event.data;
    if (!documentId) return { skipped: "no_document" };

    const existing = await step.run("check-existing", async () => {
      const rows = await db()
        .select({ id: schema.embeddings.id })
        .from(schema.embeddings)
        .where(eq(schema.embeddings.documentId, documentId))
        .limit(1);
      return rows.length > 0;
    });
    if (existing) return { skipped: "already_embedded" };

    const doc = await step.run("load-document", async () => {
      const rows = await db()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      if (rows.length === 0) throw new Error(`document ${documentId} not found`);
      return rows[0];
    });

    const chunks = chunkText(doc.content);

    const vectors = await step.run("embed-chunks", async () => {
      return embed(chunks);
    });

    await step.run("persist-embeddings", async () => {
      await db()
        .insert(schema.embeddings)
        .values(
          chunks.map((chunkText, i) => ({
            documentId,
            chunkIndex: i,
            chunkText,
            embedding: vectors[i],
            sensitivity: doc.sensitivity,
            metadata: doc.metadata,
          })),
        );
    });

    return { documentId, chunks: chunks.length };
  },
);
