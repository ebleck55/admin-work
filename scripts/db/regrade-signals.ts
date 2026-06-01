#!/usr/bin/env -S npx tsx
/**
 * Re-grade all existing signals using the Sonnet 4.6 grader.
 *
 * Background: signals were originally produced by keyword heuristics. The new
 * LLM grader produces higher-quality signals. This script:
 *   1. Deletes all existing signals + notifications
 *   2. For each ledger row, hydrates its envelope + claims
 *   3. Runs the grader
 *   4. Persists the new graded signals + fires notifications
 *
 * Concurrency-limited to 4 so we don't blow Anthropic rate limits.
 *
 * Run with: npx tsx scripts/db/regrade-signals.ts
 * (or --dry-run to skip writes)
 */

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { gradeEnvelope } from "@/lib/signals/grader";
import { notifyForSignals, persistSignals } from "@/lib/signals/persist";
import type { PayloadEnvelope, Claim } from "@/lib/ingestion/envelope";
import type { ModuleId, SignalCandidate } from "@/lib/modules/types";

const CONCURRENCY = 4;

async function hydrate(ledgerId: string): Promise<{
  envelope: PayloadEnvelope;
  claims: Array<Claim & { id: string }>;
} | null> {
  const lRows = await db()
    .select()
    .from(schema.evidenceLedger)
    .where(eq(schema.evidenceLedger.id, ledgerId))
    .limit(1);
  if (lRows.length === 0) return null;
  const envelope = lRows[0].rawPayload as unknown as PayloadEnvelope;

  const cRows = await db()
    .select()
    .from(schema.claims)
    .where(eq(schema.claims.ledgerId, ledgerId));

  const entityIds = cRows.map((r) => r.entityId).filter((id): id is string => !!id);
  const entityMap = new Map<string, { kind: Claim["entity_ref"] extends infer T ? T extends { kind: infer K } ? K : never : never; name: string }>();
  if (entityIds.length > 0) {
    const eRows = await db()
      .select()
      .from(schema.entities)
      .where(inArray(schema.entities.id, entityIds));
    for (const e of eRows) entityMap.set(e.id, { kind: e.kind, name: e.name });
  }

  const claims = cRows.map((r) => {
    const e = r.entityId ? entityMap.get(r.entityId) : undefined;
    return {
      id: r.id,
      statement: r.statement,
      module_id: r.moduleId ?? undefined,
      entity_ref: e ? { kind: e.kind, name: e.name } : undefined,
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
      confidence: r.confidence,
    } as Claim & { id: string };
  });

  return { envelope, claims };
}

async function gradeOne(
  ledgerId: string,
): Promise<{ ledgerId: string; persisted: number; mode: "graded" | "empty" | "skip"; err?: string }> {
  const hydrated = await hydrate(ledgerId);
  if (!hydrated) return { ledgerId, persisted: 0, mode: "skip" };
  if (hydrated.claims.length === 0) return { ledgerId, persisted: 0, mode: "empty" };

  let candidates: SignalCandidate[];
  try {
    candidates = await gradeEnvelope(hydrated);
  } catch (err) {
    return {
      ledgerId,
      persisted: 0,
      mode: "skip",
      err: err instanceof Error ? err.message : String(err),
    };
  }

  if (candidates.length === 0) return { ledgerId, persisted: 0, mode: "empty" };

  const byModule = new Map<ModuleId, SignalCandidate[]>();
  for (const c of candidates) {
    const mod = (c.attributes?.module_id_graded as ModuleId) ?? "priorities";
    const list = byModule.get(mod) ?? [];
    list.push(c);
    byModule.set(mod, list);
  }
  let total = 0;
  for (const [mod, cands] of byModule.entries()) {
    const rows = await persistSignals(cands, mod);
    await notifyForSignals(rows);
    total += rows.length;
  }
  return { ledgerId, persisted: total, mode: "graded" };
}

async function pool<T>(items: T[], worker: (item: T) => Promise<unknown>, limit: number) {
  let idx = 0;
  const runners = new Array(limit).fill(null).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "DRY RUN" : "LIVE");

  // 1. Clear existing signals + notifications
  if (!dryRun) {
    const delN = await db().delete(schema.notifications).returning({ id: schema.notifications.id });
    const delS = await db().delete(schema.signals).returning({ id: schema.signals.id });
    console.log(`Cleared ${delS.length} signals, ${delN.length} notifications`);
  } else {
    const s = await db().select({ id: schema.signals.id }).from(schema.signals);
    const n = await db().select({ id: schema.notifications.id }).from(schema.notifications);
    console.log(`Would clear ${s.length} signals, ${n.length} notifications`);
  }

  // 2. List all ledger rows
  const ledgerIds = (
    await db().select({ id: schema.evidenceLedger.id }).from(schema.evidenceLedger)
  ).map((r) => r.id);
  console.log(`Re-grading ${ledgerIds.length} envelopes (concurrency ${CONCURRENCY})…`);

  if (dryRun) {
    console.log("Stopping before grading (dry-run).");
    return;
  }

  // 3. Grade in parallel
  let done = 0;
  let totalSignals = 0;
  const errors: string[] = [];
  const t0 = Date.now();

  await pool(
    ledgerIds,
    async (id) => {
      const r = await gradeOne(id);
      done += 1;
      totalSignals += r.persisted;
      if (r.err) errors.push(`${id}: ${r.err}`);
      if (done % 25 === 0) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(`  [${elapsed}s] ${done}/${ledgerIds.length} envelopes, ${totalSignals} signals so far`);
      }
    },
    CONCURRENCY,
  );

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nDone in ${elapsed}s. ${done} envelopes processed, ${totalSignals} signals persisted.`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} errors:`);
    errors.slice(0, 20).forEach((e) => console.log(" ", e));
    if (errors.length > 20) console.log(`  ... ${errors.length - 20} more`);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
