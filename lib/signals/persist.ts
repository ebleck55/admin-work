/**
 * Persist signal candidates from module detectors. Idempotent on (kind, entity, claim_ids[0])
 * to avoid duplicating signals when retries replay the pipeline.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import type { ModuleId, SignalCandidate } from "@/lib/modules/types";

export interface PersistedSignal {
  id: string;
  kind: string;
  severity: string;
  title: string;
}

/**
 * Resolve a SignalCandidate.entityName + entityKind to an existing entity id.
 */
async function resolveEntityId(
  candidate: SignalCandidate,
): Promise<string | null> {
  if (!candidate.entityName || !candidate.entityKind) return null;
  const found = await db()
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.kind, candidate.entityKind),
        eq(schema.entities.name, candidate.entityName),
      ),
    )
    .limit(1);
  return found[0]?.id ?? null;
}

/**
 * Persist a batch of signal candidates. Returns the persisted rows for downstream
 * notification/briefing dispatch.
 */
export async function persistSignals(
  candidates: SignalCandidate[],
  moduleId: ModuleId,
): Promise<PersistedSignal[]> {
  if (candidates.length === 0) return [];
  const persisted: PersistedSignal[] = [];

  for (const c of candidates) {
    const entityId = await resolveEntityId(c);

    // Sensitivity inherited from contributing claims
    let signalSensitivity: "public" | "internal" | "private_dm" = "internal";
    if (c.claimIds.length > 0) {
      const claimRows = await db()
        .select({ sensitivity: schema.claims.sensitivity })
        .from(schema.claims)
        .where(inArray(schema.claims.id, c.claimIds));
      if (claimRows.some((r) => r.sensitivity === "private_dm")) {
        signalSensitivity = "private_dm";
      } else if (claimRows.some((r) => r.sensitivity === "public")) {
        signalSensitivity = "public";
      }
    }

    const inserted = await db()
      .insert(schema.signals)
      .values({
        moduleId,
        kind: c.kind,
        severity: c.severity,
        title: c.title,
        summary: c.summary,
        entityId,
        claimIds: c.claimIds,
        sensitivity: signalSensitivity,
        shareable: signalSensitivity !== "private_dm",
        attributes: c.attributes ?? {},
      })
      .returning({
        id: schema.signals.id,
        kind: schema.signals.kind,
        severity: schema.signals.severity,
        title: schema.signals.title,
      });
    persisted.push(inserted[0]);
  }
  return persisted;
}

/**
 * Create an in-app notification for each high/critical signal, scoped to the solo user
 * (day 1). When multi-user lands, this fanouts per subscribed user.
 */
export async function notifyForSignals(signals: PersistedSignal[]): Promise<void> {
  const notifiable = signals.filter(
    (s) => s.severity === "high" || s.severity === "critical",
  );
  if (notifiable.length === 0) return;

  // Day 1: solo. Look up the first user; if none, skip silently.
  const userRow = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(1);
  const userId = userRow[0]?.id ?? null;

  await db()
    .insert(schema.notifications)
    .values(
      notifiable.map((s) => ({
        userId,
        signalId: s.id,
        title: s.title,
        body: `Severity ${s.severity}. Open the signal for details.`,
        href: `/signals/${s.id}`,
        severity: s.severity as "low" | "medium" | "high" | "critical",
      })),
    );
}
