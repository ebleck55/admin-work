/**
 * Evidence-ledger writes. Append-only — nothing here updates or deletes rows.
 *
 * On insert, we write the envelope into `evidence_ledger`, fan claims into `claims`,
 * fan evidence quotes into `evidence_quotes`, hydrate `documents` if raw_text is present,
 * and resolve/create stub `entities` from the envelope's `entities` array.
 *
 * The downstream Inngest job (`process-payload`) handles embedding + signal detection.
 */

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import type { PayloadEnvelope } from "@/lib/ingestion/envelope";
import { redactPii } from "@/lib/llm/safety";

export interface LedgerWriteResult {
  ledgerId: string;
  documentId?: string;
  claimIds: string[];
  entityIds: string[];
  alreadyExists: boolean;
  redactions: Array<{ rule: string; count: number }>;
}

/**
 * Idempotent write: if a row already exists for (source_system, source_id) we return
 * the existing ledger id without writing anything new. This makes the upstream agent
 * safe to retry.
 */
export async function writeEnvelope(env: PayloadEnvelope): Promise<LedgerWriteResult> {
  const database = db();

  // Idempotency check via the (source_system, source_id) unique index
  const existing = await database
    .select({ id: schema.evidenceLedger.id })
    .from(schema.evidenceLedger)
    .where(
      and(
        eq(schema.evidenceLedger.sourceSystem, env.source_system),
        eq(schema.evidenceLedger.sourceId, env.source_id),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      ledgerId: existing[0].id,
      claimIds: [],
      entityIds: [],
      alreadyExists: true,
      redactions: [],
    };
  }

  // Tier-1 PII redaction on raw text and quotes before persistence
  const redactionsAcc: Array<{ rule: string; count: number }> = [];
  const redactedRawText = env.raw_text
    ? (() => {
        const r = redactPii(env.raw_text);
        redactionsAcc.push(...r.redactions);
        return r.text;
      })()
    : undefined;
  const redactedQuotes = env.evidence.map((e) => {
    const r = redactPii(e.quote);
    redactionsAcc.push(...r.redactions);
    return { ...e, quote: r.text };
  });

  // Insert ledger row
  const ledgerRow = await database
    .insert(schema.evidenceLedger)
    .values({
      sourceSystem: env.source_system,
      sourceId: env.source_id,
      sourceUrl: env.source_url ?? null,
      collectedAt: new Date(env.collected_at),
      sourceTimestamp: new Date(env.source_timestamp),
      actor: env.actor ?? null,
      sensitivity: env.sensitivity,
      confidence: env.confidence,
      rawPayload: env as unknown as Record<string, unknown>,
      sourcePayloadRef: env.source_payload_ref ?? null,
    })
    .returning({ id: schema.evidenceLedger.id });

  const ledgerId = ledgerRow[0].id;

  // Hydrate a `documents` row when raw_text is present, for RAG + display
  let documentId: string | undefined;
  if (redactedRawText) {
    const inserted = await database
      .insert(schema.documents)
      .values({
        ledgerId,
        title: env.title ?? `${env.source_system}:${env.source_id}`,
        content: redactedRawText,
        sensitivity: env.sensitivity,
        metadata: { actor: env.actor, sourceUrl: env.source_url },
      })
      .returning({ id: schema.documents.id });
    documentId = inserted[0].id;
  }

  // Resolve or create stub entities; envelope.entities is hints, not authoritative
  const entityIds: string[] = [];
  for (const ent of env.entities) {
    const found = await database
      .select({ id: schema.entities.id })
      .from(schema.entities)
      .where(and(eq(schema.entities.kind, ent.kind), eq(schema.entities.name, ent.name)))
      .limit(1);
    if (found.length > 0) {
      entityIds.push(found[0].id);
      continue;
    }
    const created = await database
      .insert(schema.entities)
      .values({
        kind: ent.kind,
        name: ent.name,
        externalId: ent.external_id ?? null,
        attributes: ent.attributes ?? {},
      })
      .returning({ id: schema.entities.id });
    entityIds.push(created[0].id);
  }

  // Insert claims; claim.entity_ref hints at an entity by (kind, name)
  const claimIds: string[] = [];
  for (let i = 0; i < env.claims.length; i++) {
    const claim = env.claims[i];
    let claimEntityId: string | null = null;
    if (claim.entity_ref) {
      const matched = entityIds[
        env.entities.findIndex(
          (e) =>
            e.kind === claim.entity_ref!.kind && e.name === claim.entity_ref!.name,
        )
      ];
      claimEntityId = matched ?? null;
    }
    const ins = await database
      .insert(schema.claims)
      .values({
        ledgerId,
        entityId: claimEntityId,
        moduleId: claim.module_id ?? null,
        statement: claim.statement,
        attributes: claim.attributes ?? {},
        confidence: claim.confidence,
        sensitivity: env.sensitivity,
      })
      .returning({ id: schema.claims.id });
    claimIds.push(ins[0].id);

    // Attach evidence quotes whose claim_index points to this claim
    const matchingQuotes = redactedQuotes.filter((q) => q.claim_index === i);
    if (matchingQuotes.length > 0) {
      await database.insert(schema.evidenceQuotes).values(
        matchingQuotes.map((q) => ({
          claimId: ins[0].id,
          quote: q.quote,
          position: q.position ?? null,
        })),
      );
    }
  }

  return {
    ledgerId,
    documentId,
    claimIds,
    entityIds,
    alreadyExists: false,
    redactions: redactionsAcc,
  };
}
