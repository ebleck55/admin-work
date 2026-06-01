/**
 * Phase 7 situation synthesizer.
 *
 * Triggered:
 *   - `situations/synthesize.requested` event (fired from process-payload
 *     when ≥1 new signal lands)
 *   - Throttled to once per 30 minutes globally (Inngest concurrency lock)
 *
 * Pulls recent ungrouped signals + open situations, calls the Opus 4.7
 * synthesizer, persists the results.
 */

import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { synthesize } from "@/lib/situations/synthesizer";

const RECENT_SIGNAL_WINDOW_DAYS = 14;
const MAX_UNGROUPED_SIGNALS = 60;

export const synthesizeSituations = inngest.createFunction(
  {
    id: "synthesize-situations",
    retries: 1,
    concurrency: { limit: 1 },
    throttle: { limit: 1, period: "30m" },
  },
  [
    { event: "situations/synthesize.requested" },
    { cron: "TZ=America/Chicago 0 8,12,16 * * *" },
  ],
  async ({ step }) => {
    // Load open situations
    const openSituations = await step.run("load-open-situations", async () => {
      const rows = await db()
        .select()
        .from(schema.situations)
        .where(
          and(
            or(
              eq(schema.situations.status, "open"),
              eq(schema.situations.status, "watching"),
              eq(schema.situations.status, "escalated"),
            ),
            or(isNull(schema.situations.snoozedUntil), gte(schema.situations.snoozedUntil, new Date())),
          ),
        );

      const entityIds = rows
        .map((r) => r.entityId)
        .filter((id): id is string => !!id);
      const entityMap = new Map<string, { id: string; kind: string; name: string }>();
      if (entityIds.length > 0) {
        const entRows = await db()
          .select()
          .from(schema.entities)
          .where(inArray(schema.entities.id, entityIds));
        for (const e of entRows) entityMap.set(e.id, { id: e.id, kind: e.kind, name: e.name });
      }

      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        narrativeMd: r.narrativeMd,
        status: r.status as string,
        severity: r.severity as string,
        signalIds: r.signalIds,
        entity: r.entityId ? entityMap.get(r.entityId) ?? null : null,
        lastSynthesizedAt: r.lastSynthesizedAt
          ? r.lastSynthesizedAt.toISOString()
          : null,
      }));
    });

    // Load recent signals not yet attached to any situation
    const ungroupedSignals = await step.run("load-ungrouped-signals", async () => {
      const claimedIds = new Set<string>();
      for (const sit of openSituations) {
        for (const id of sit.signalIds) claimedIds.add(id);
      }
      const since = new Date(
        Date.now() - RECENT_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const allRecent = await db()
        .select()
        .from(schema.signals)
        .where(
          and(
            gte(schema.signals.detectedAt, since),
            eq(schema.signals.shareable, true),
          ),
        );

      const ungrouped = allRecent
        .filter((s) => !claimedIds.has(s.id))
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
        .slice(0, MAX_UNGROUPED_SIGNALS);

      const entityIds = ungrouped
        .map((s) => s.entityId)
        .filter((id): id is string => !!id);
      const entityMap = new Map<string, { id: string; kind: string; name: string }>();
      if (entityIds.length > 0) {
        const entRows = await db()
          .select()
          .from(schema.entities)
          .where(inArray(schema.entities.id, entityIds));
        for (const e of entRows) entityMap.set(e.id, { id: e.id, kind: e.kind, name: e.name });
      }

      return ungrouped.map((s) => ({
        id: s.id,
        kind: s.kind as string,
        severity: s.severity as string,
        title: s.title,
        summary: s.summary,
        moduleId: s.moduleId as string | null,
        detectedAt: s.detectedAt.toISOString(),
        entity: s.entityId ? entityMap.get(s.entityId) ?? null : null,
      }));
    });

    if (ungroupedSignals.length === 0 && openSituations.length === 0) {
      return { skipped: "no_input" };
    }

    const synthesized = await step.run("call-synthesizer", async () =>
      synthesize({ ungroupedSignals, openSituations }),
    );

    // Persist new situations
    const newCount = await step.run("persist-new-situations", async () => {
      if (synthesized.new_situations.length === 0) return 0;
      let inserted = 0;
      for (const ns of synthesized.new_situations) {
        // Determine sensitivity by checking contributing signals
        let sensitivity: "public" | "internal" | "private_dm" = "internal";
        if (ns.contributing_signal_ids.length > 0) {
          const rows = await db()
            .select({ sensitivity: schema.signals.sensitivity })
            .from(schema.signals)
            .where(inArray(schema.signals.id, ns.contributing_signal_ids));
          if (rows.some((r) => r.sensitivity === "private_dm")) sensitivity = "private_dm";
        }

        await db().insert(schema.situations).values({
          title: ns.title,
          narrativeMd: ns.narrative_md,
          reasoningMd: ns.reasoning_md,
          recommendedAction: ns.recommended_action ?? null,
          status: (ns.status ?? "open") as "open" | "watching" | "escalated" | "resolved",
          severity: ns.severity,
          entityId: ns.primary_entity_id ?? null,
          signalIds: ns.contributing_signal_ids,
          decisionFrame: ns.decision_frame ?? null,
          sensitivity,
          shareable: sensitivity !== "private_dm",
          lastSynthesizedAt: new Date(),
        });
        inserted += 1;
      }
      return inserted;
    });

    // Apply updates to existing situations
    const updatedCount = await step.run("apply-updates", async () => {
      let updated = 0;
      for (const u of synthesized.updates) {
        const updateSet: Partial<typeof schema.situations.$inferInsert> = {
          updatedAt: new Date(),
          lastSynthesizedAt: new Date(),
        };
        if (u.narrative_md !== undefined) updateSet.narrativeMd = u.narrative_md;
        if (u.reasoning_md !== undefined) updateSet.reasoningMd = u.reasoning_md;
        if (u.recommended_action !== undefined)
          updateSet.recommendedAction = u.recommended_action;
        if (u.severity !== undefined) updateSet.severity = u.severity;
        if (u.status !== undefined) {
          updateSet.status = u.status;
          if (u.status === "resolved") updateSet.resolvedAt = new Date();
        }
        if (u.decision_frame !== undefined) updateSet.decisionFrame = u.decision_frame;

        if (u.add_signal_ids && u.add_signal_ids.length > 0) {
          // Append to existing array
          const existing = await db()
            .select({ signalIds: schema.situations.signalIds })
            .from(schema.situations)
            .where(eq(schema.situations.id, u.situation_id))
            .limit(1);
          if (existing[0]) {
            const merged = Array.from(
              new Set([...existing[0].signalIds, ...u.add_signal_ids]),
            );
            updateSet.signalIds = merged;
          }
        }

        await db()
          .update(schema.situations)
          .set(updateSet)
          .where(eq(schema.situations.id, u.situation_id));
        updated += 1;
      }
      return updated;
    });

    return {
      ungroupedConsidered: ungroupedSignals.length,
      openConsidered: openSituations.length,
      newCount,
      updatedCount,
    };
  },
);
