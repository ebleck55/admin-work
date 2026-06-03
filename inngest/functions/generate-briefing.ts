/**
 * Daily briefing generator.
 *
 * Triggered by:
 *   - briefing/preload.requested  (from the Vercel Cron route, with forDate)
 *
 * Phase 13b: composes from SITUATIONS (the higher-order Phase 7 narrative
 * unit), not raw signals. Signals fall back only if no active situations
 * exist. Each run is logged to `briefing_runs` for auditability.
 */

import { and, count, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";
import { varietySeed } from "@/lib/prompts/variety";
import {
  getInfluencingPreferenceFactIds,
  loadPreferenceContext,
} from "@/lib/prompts/preference-context";

function dayBounds(forDate: string): { start: Date; end: Date } {
  const start = new Date(`${forDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

const SEVERITY_RANK_SQL = sql`array_position(ARRAY['critical','high','medium','low']::text[], severity::text)`;

export const generateBriefing = inngest.createFunction(
  { id: "generate-briefing", retries: 2, concurrency: { limit: 1 } },
  { event: "briefing/preload.requested" },
  async ({ event, step }) => {
    const startedAt = Date.now();
    const forDate = event.data.forDate ?? new Date().toISOString().slice(0, 10);
    const moduleId = event.data.moduleId as string | undefined;
    const trigger = (event.data as { trigger?: string }).trigger ?? "cron";

    const briefingId = await step.run("create-partial", async () => {
      const inserted = await db()
        .insert(schema.briefings)
        .values({
          moduleId: (moduleId as never) ?? null,
          title: moduleId
            ? `${moduleId} briefing — ${forDate}`
            : `Daily briefing — ${forDate}`,
          forDate: new Date(forDate),
          status: "partial",
          contentMd: null,
          audioUrl: null,
          signalIds: [],
          situationIds: [],
          influencingMemoryFactIds: [],
        })
        .returning({ id: schema.briefings.id });
      return inserted[0].id;
    });

    // PRIMARY: active situations (Phase 13b refactor)
    const situationRows = await step.run("load-situations", async () => {
      const conditions = [
        or(
          eq(schema.situations.status, "open"),
          eq(schema.situations.status, "watching"),
          eq(schema.situations.status, "escalated"),
        ),
        or(
          isNull(schema.situations.snoozedUntil),
          gte(schema.situations.snoozedUntil, new Date()),
        ),
        eq(schema.situations.shareable, true),
      ];
      return db()
        .select()
        .from(schema.situations)
        .where(and(...conditions))
        .orderBy(SEVERITY_RANK_SQL, desc(schema.situations.updatedAt))
        .limit(8);
    });

    const { start, end } = dayBounds(forDate);

    // SECONDARY: today's signals (used either as supporting context or as
    // the sole source if no situations are active)
    const signalRows = await step.run("load-signals", async () => {
      const conditions = [
        gte(schema.signals.detectedAt, start),
        lte(schema.signals.detectedAt, end),
        eq(schema.signals.shareable, true),
      ];
      if (moduleId) {
        conditions.push(eq(schema.signals.moduleId, moduleId as never));
      }
      return db()
        .select()
        .from(schema.signals)
        .where(and(...conditions))
        .orderBy(desc(schema.signals.severity), desc(schema.signals.detectedAt))
        .limit(25);
    });

    // Quick total counts for the audit log
    const todayCount = await step.run("count-today-signals", async () => {
      const rows = await db()
        .select({ n: count() })
        .from(schema.signals)
        .where(gte(schema.signals.detectedAt, start));
      return Number(rows[0]?.n ?? 0);
    });

    const preferenceContext = await step.run("load-preference-context", async () =>
      loadPreferenceContext("brief"),
    );
    const influencingFactIds = preferenceContext
      ? await getInfluencingPreferenceFactIds()
      : [];

    let briefingMd = "_No active situations or signals — the ledger had no qualifying activity._";
    let errorMessage: string | null = null;

    if (situationRows.length > 0 || signalRows.length > 0) {
      const situationsBlock = situationRows.length
        ? situationRows
            .map(
              (s, i) =>
                `[situation #${i + 1} — ${s.severity} — ${s.status}]\nTitle: ${s.title}\nNarrative: ${s.narrativeMd}\nWhy it matters: ${s.reasoningMd}${s.recommendedAction ? `\nRecommended action: ${s.recommendedAction}` : ""}`,
            )
            .join("\n\n")
        : "(no active situations yet)";

      const signalsBlock = signalRows.length
        ? signalRows
            .map(
              (s, i) =>
                `[signal #${i + 1} — ${s.kind} — ${s.severity}] ${s.title} — ${s.summary}`,
            )
            .join("\n")
        : "(no fresh signals today; rely on the situations above)";

      const userPrompt = `Generate today's briefing for ${forDate}${moduleId ? ` (module: ${moduleId})` : ""}.

ACTIVE SITUATIONS (primary content — these are the durable narratives Eric is tracking):
${situationsBlock}

TODAY'S RAW SIGNALS (supporting context — cite if they add detail beyond the situations):
${signalsBlock}

Compose a briefing in 4-6 short sections. Each section should advance one thread. Lead with the most actionable item. Cite [situation #N] or [signal #N] for non-trivial claims. Match a chief-of-staff voice: declarative, specific, no hedging.`;

      try {
        const opusResult = await step.run("call-opus", async () =>
          callClaude({
            modelKey: "opus47",
            system: systemPromptFor({
              mode: "brief",
              extra: preferenceContext
                ? `${preferenceContext}\n\n${varietySeed()}`
                : varietySeed(),
            }),
            cacheSystem: true,
            prompt: userPrompt,
            maxTokens: 4096,
            purpose: "daily-briefing",
          }),
        );
        briefingMd = opusResult.text;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        console.error("[generate-briefing] opus call failed:", errorMessage);
        briefingMd = `_Briefing generation failed: ${errorMessage}_`;
      }
    }

    await step.run("update-briefing", async () => {
      await db()
        .update(schema.briefings)
        .set({
          contentMd: briefingMd,
          status: errorMessage ? "failed" : "complete",
          signalIds: signalRows.map((s) => s.id),
          situationIds: situationRows.map((s) => s.id),
          influencingMemoryFactIds: influencingFactIds,
          generatedAt: new Date(),
          failedReason: errorMessage,
        })
        .where(eq(schema.briefings.id, briefingId));
    });

    await step.run("log-run", async () => {
      await db().insert(schema.briefingRuns).values({
        forDate,
        signalCountToday: todayCount,
        situationCountActive: situationRows.length,
        outputChars: briefingMd.length,
        durationMs: Date.now() - startedAt,
        briefingId,
        errorMessage,
        trigger,
      });
    });

    if (!errorMessage) {
      await step.sendEvent("request-audio", {
        name: "briefing/audio.requested",
        data: { briefingId },
      });
    }

    return {
      briefingId,
      situationCount: situationRows.length,
      signalCount: signalRows.length,
      outputChars: briefingMd.length,
    };
  },
);
