/**
 * Central processing pipeline.
 *
 * Triggered by `ingestion/payload.received`. Steps:
 *   1. Mark the ledger row processed
 *   2. Hydrate envelope + claims from the DB
 *   3. Run the LLM grader (Sonnet 4.6) — produces a curated signal list per envelope
 *   4. Fall back to per-module heuristic detectors only if the grader returns
 *      nothing AND the envelope is marked salesforce (deterministic data — the
 *      grader has nothing to add over keyword detectors there)
 *   5. Persist signals + fire in-app notifications for high/critical
 *
 * Embedding (Phase 2) runs in a separate Inngest function listening on the
 * same event — they fan out in parallel.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { allModules } from "@/lib/modules/registry";
import { PayloadEnvelope, type Claim } from "@/lib/ingestion/envelope";
import { persistSignals, notifyForSignals } from "@/lib/signals/persist";
import { gradeEnvelope } from "@/lib/signals/grader";
import type { ModuleId, SignalCandidate } from "@/lib/modules/types";

export const processPayload = inngest.createFunction(
  { id: "process-payload", retries: 3, concurrency: { limit: 4 } },
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

    const envelope = ledgerRow.rawPayload as unknown as PayloadEnvelope;

    const claimsForDetectors = claimRows.map((r) => ({
      id: r.id,
      statement: r.statement,
      module_id: r.moduleId ?? undefined,
      entity_ref: undefined as Claim["entity_ref"],
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
      confidence: r.confidence,
    }));

    // Hydrate entity_ref on each claim from the entities table
    await step.run("hydrate-entity-refs", async () => {
      const entityIds = claimRows
        .map((r) => r.entityId)
        .filter((id): id is string => !!id);
      if (entityIds.length === 0) return;
      const entityMap = new Map<
        string,
        {
          kind: "account" | "opportunity" | "contact" | "rep" | "initiative" | "competitor";
          name: string;
        }
      >();
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

    // ---- LLM grader (primary path) ----
    const gradedCandidates = await step.run("grade-signals", async () =>
      gradeEnvelope({ envelope, claims: claimsForDetectors }),
    );

    // ---- Heuristic fallback (only when grader returned nothing) ----
    let fallbackCandidates: Array<{ moduleId: ModuleId; candidates: SignalCandidate[] }> = [];
    if (gradedCandidates.length === 0) {
      fallbackCandidates = await step.run("run-heuristic-fallback", async () => {
        const out: Array<{ moduleId: ModuleId; candidates: SignalCandidate[] }> = [];
        for (const mod of allModules()) {
          if (!mod.envelopeFilter(envelope)) continue;
          const cands = (
            await Promise.all(
              mod.signalDetectors.map((det) =>
                det({ envelope, claims: claimsForDetectors }),
              ),
            )
          ).flat();
          if (cands.length > 0) out.push({ moduleId: mod.id, candidates: cands });
        }
        return out;
      });
    }

    // ---- Persist ----
    const allPersisted: Array<{ id: string; kind: string; severity: string; title: string }> = [];

    if (gradedCandidates.length > 0) {
      // Group grader output by module
      const byModule = new Map<ModuleId, SignalCandidate[]>();
      for (const c of gradedCandidates) {
        const mod = (c.attributes?.module_id_graded as ModuleId) ?? "priorities";
        const list = byModule.get(mod) ?? [];
        list.push(c);
        byModule.set(mod, list);
      }
      for (const [mod, cands] of byModule.entries()) {
        const persisted = await step.run(`persist-graded-${mod}`, async () => {
          const rows = await persistSignals(cands, mod);
          await notifyForSignals(rows);
          return rows;
        });
        allPersisted.push(...persisted);
      }
    } else {
      for (const { moduleId, candidates } of fallbackCandidates) {
        const persisted = await step.run(`persist-fallback-${moduleId}`, async () => {
          const rows = await persistSignals(candidates, moduleId);
          await notifyForSignals(rows);
          return rows;
        });
        allPersisted.push(...persisted);
      }
    }

    return {
      ledgerId,
      signalsDetected: allPersisted.length,
      mode: gradedCandidates.length > 0 ? "graded" : "heuristic",
      signalIds: allPersisted.map((s) => s.id),
    };
  },
);
