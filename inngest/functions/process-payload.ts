/**
 * Central processing pipeline.
 *
 * Triggered by `ingestion/payload.received`. Phase-0 scope is intentionally minimal:
 *   1. Mark the ledger row processed
 *   2. (placeholder) Classify the payload against module filters
 *   3. (placeholder) Embed the document into pgvector
 *   4. (placeholder) Run signal detectors
 *
 * Each step will fill in as modules land (Phase 1: pipeline; Phase 3: outlook+cs+team; etc).
 */

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";

export const processPayload = inngest.createFunction(
  { id: "process-payload", retries: 3 },
  { event: "ingestion/payload.received" },
  async ({ event, step }) => {
    const { ledgerId } = event.data;

    await step.run("mark-processing-start", async () => {
      await db()
        .update(schema.evidenceLedger)
        .set({ processedAt: new Date(), processingError: null })
        .where(eq(schema.evidenceLedger.id, ledgerId));
    });

    // Placeholders — fleshed out as modules ship
    const classification = await step.run("classify", async () => {
      // TODO(phase-1+): run Haiku classifier against module filters
      return { moduleIds: [] as string[] };
    });

    await step.run("embed", async () => {
      // TODO(phase-2): chunk + OpenAI text-embedding-3-small → pgvector
      return { embedded: false };
    });

    await step.run("detect-signals", async () => {
      // TODO(phase-1+): per-module signal detectors
      return { signals: [] as string[] };
    });

    await step.sendEvent("request-alerts-scan", {
      name: "alerts/scan.requested",
      data: { since: new Date().toISOString() },
    });

    return { ledgerId, classification };
  },
);
