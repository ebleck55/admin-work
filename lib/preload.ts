/**
 * Preload-or-on-demand pattern for daily briefings.
 *
 * Ported from learning-quest-grade5: cron fires a preload event in the early
 * morning; if Eric opens the dashboard before preload finishes (or before cron
 * fires at all), we fall back to on-demand generation.
 *
 * Returns the briefing row to render. Callers should treat status=partial
 * as a hint to poll (or open a websocket later).
 */

import { and, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";

export interface BriefingRow {
  id: string;
  moduleId: string | null;
  title: string;
  forDate: Date;
  contentMd: string | null;
  audioUrl: string | null;
  status: "complete" | "partial" | "failed";
  generatedAt: Date;
}

export interface PreloadResult {
  briefing: BriefingRow | null;
  triggered: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Look up today's briefing for the given module (or the unified daily briefing if
 * `moduleId` is omitted). If it doesn't exist or is partial+stale, fire a fresh
 * generation event and return whatever we have.
 */
export async function getOrTriggerBriefing(opts: {
  forDate?: string;
  moduleId?: string;
}): Promise<PreloadResult> {
  const forDate = opts.forDate ?? todayIso();
  const moduleId = opts.moduleId;

  const conditions = [eq(schema.briefings.forDate, new Date(forDate))];
  if (moduleId) {
    conditions.push(eq(schema.briefings.moduleId, moduleId as never));
  } else {
    conditions.push(isNull(schema.briefings.moduleId));
  }

  const rows = await db()
    .select()
    .from(schema.briefings)
    .where(and(...conditions))
    .orderBy(desc(schema.briefings.generatedAt))
    .limit(1);

  const existing = rows[0];
  if (existing && existing.status === "complete") {
    return { briefing: toRow(existing), triggered: false };
  }
  if (existing && existing.status === "partial") {
    // Already in flight — return what we have without re-triggering
    return { briefing: toRow(existing), triggered: false };
  }

  await inngest.send({
    name: "briefing/preload.requested",
    data: { forDate, moduleId },
  });
  return { briefing: existing ? toRow(existing) : null, triggered: true };
}

function toRow(r: typeof schema.briefings.$inferSelect): BriefingRow {
  return {
    id: r.id,
    moduleId: r.moduleId,
    title: r.title,
    forDate: r.forDate,
    contentMd: r.contentMd,
    audioUrl: r.audioUrl,
    status: r.status,
    generatedAt: r.generatedAt,
  };
}
