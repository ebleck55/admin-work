/**
 * Central processing pipeline.
 *
 * Triggered by `ingestion/payload.received`. Steps:
 *   1. Mark the ledger row processed
 *   2. Hydrate envelope + claims from the DB
 *   3. For each matching module, run signal detectors and persist signals
 *   4. Send in-app notifications for high/critical signals
 *   5. Fire alerts/scan.requested for downstream sweeps
 *
 * Embedding (Phase 2) attaches in a separate Inngest function so re-embedding
 * doesn't require replaying the whole pipeline.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { allModules } from "@/lib/modules/registry";
import { PayloadEnvelope, type Claim } from "@/lib/ingestion/envelope";
import { persistSignals, notifyForSignals } from "@/lib/signals/persist";

export const processPayload = inngest.createFunction(
  { id: "process-payload", retries: 3 },
  { event: "ingestion/payload.received" },
  async ({ event, step }) => {
    const { ledgerId } = event.data;

    const ledgerRow = await step.run("load-ledger-row", async () => {
      const rows = await db()
        .select()
        .from(schema.evidenceLedger)
        .where(eq(schema.evidenceLedger.id, ledgerId))
        .limit(1);
      if (rows.length === 0) throw new Error(`ledger ${ledgerId} not found`);
      return rows[0];
    });

    await step.run("mark-processing-start", async () => {
      await db()
        .update(schema.evidenceLedger)
        .set({ processedAt: new Date(), processingError: null })
        .where(eq(schema.evidenceLedger.id, ledgerId));
    });

    const claimRows = await step.run("load-claims", async () => {
      return db()
        .select()
        .from(schema.claims)
        .where(eq(schema.claims.ledgerId, ledgerId));
    });

    // The envelope is the raw_payload JSON; reparsing it gives us the entity refs
    // needed by detectors. Tolerate schema drift on old rows.
    const envelope = ledgerRow.rawPayload as unknown as PayloadEnvelope;

    const claimsForDetectors = claimRows.map((r) => ({
      id: r.id,
      statement: r.statement,
      module_id: r.moduleId ?? undefined,
      entity_ref: undefined as Claim["entity_ref"],
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
      confidence: r.confidence,
    }));

    // Backfill entity_ref on each claim by hydrating from the entities table
    await step.run("hydrate-entity-refs", async () => {
      const entityIds = claimRows.map((r) => r.entityId).filter((id): id is string => !!id);
      if (entityIds.length === 0) return;
      const entityMap = new Map<string, { kind: typeof claimRows[number] extends never ? never : "account" | "opportunity" | "contact" | "rep" | "initiative" | "competitor"; name: string }>();
      for (const e of await db().select().from(schema.entities)) {
        if (entityIds.includes(e.id)) entityMap.set(e.id, { kind: e.kind, name: e.name });
      }
      for (let i = 0; i < claimRows.length; i++) {
        const eid = claimRows[i].entityId;
        if (!eid) continue;
        const e = entityMap.get(eid);
        if (e) claimsForDetectors[i].entity_ref = { kind: e.kind, name: e.name };
      }
    });

    const allSignalsPersisted: Array<{ id: string; kind: string; severity: string; title: string }> = [];

    for (const mod of allModules()) {
      if (!mod.envelopeFilter(envelope)) continue;
      const candidates = (
        await Promise.all(
          mod.signalDetectors.map((det) =>
            det({ envelope, claims: claimsForDetectors }),
          ),
        )
      ).flat();
      if (candidates.length === 0) continue;
      const persisted = await step.run(`persist-signals-${mod.id}`, async () => {
        const rows = await persistSignals(candidates, mod.id);
        await notifyForSignals(rows);
        return rows;
      });
      allSignalsPersisted.push(...persisted);
    }

    await step.sendEvent("request-alerts-scan", {
      name: "alerts/scan.requested",
      data: { since: new Date().toISOString() },
    });

    return {
      ledgerId,
      signalsDetected: allSignalsPersisted.length,
      signalIds: allSignalsPersisted.map((s) => s.id),
    };
  },
);
