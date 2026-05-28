/**
 * Daily briefing generator.
 *
 * Triggered by:
 *   - briefing/preload.requested  (from the Vercel Cron route, with forDate)
 *
 * Pulls the day's signals + opportunities, generates a markdown briefing with
 * Claude Opus 4.7, persists to `briefings`, and fires briefing/audio.requested
 * to render the audio summary.
 */

import { and, desc, gte, lte, isNull, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";
import { varietySeed } from "@/lib/prompts/variety";

function dayBounds(forDate: string): { start: Date; end: Date } {
  const start = new Date(`${forDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export const generateBriefing = inngest.createFunction(
  { id: "generate-briefing", retries: 2, concurrency: { limit: 1 } },
  { event: "briefing/preload.requested" },
  async ({ event, step }) => {
    const forDate = event.data.forDate ?? new Date().toISOString().slice(0, 10);
    const moduleId = event.data.moduleId as string | undefined;

    // Insert a "partial" briefing row immediately so the UI can show "preparing"
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
        })
        .returning({ id: schema.briefings.id });
      return inserted[0].id;
    });

    const { start, end } = dayBounds(forDate);

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

    let briefingMd = "_No signals detected today — the ledger had no qualifying activity._";
    if (signalRows.length > 0) {
      const signalsBlock = signalRows
        .map(
          (s, i) =>
            `[signal #${i + 1} — ${s.kind} — ${s.severity}]\nTitle: ${s.title}\nSummary: ${s.summary}`,
        )
        .join("\n\n");

      const userPrompt = `Generate a daily briefing for ${forDate}${moduleId ? ` (module: ${moduleId})` : ""}.\n\nDETECTED SIGNALS:\n\n${signalsBlock}\n\nCompose 4-6 short sections grouped by theme. Cite each non-trivial claim by referencing [signal #N]. Lead with the most actionable insight. Match a calm, diagnostic tone.`;

      const { text } = await step.run("call-opus", async () =>
        callClaude({
          modelKey: "opus47",
          system: systemPromptFor({ mode: "brief", extra: varietySeed() }),
          cacheSystem: true,
          prompt: userPrompt,
          maxTokens: 4096,
          purpose: "daily-briefing",
        }),
      );
      briefingMd = text;
    }

    await step.run("update-briefing", async () => {
      await db()
        .update(schema.briefings)
        .set({
          contentMd: briefingMd,
          status: "complete",
          signalIds: signalRows.map((s) => s.id),
          generatedAt: new Date(),
        })
        .where(eq(schema.briefings.id, briefingId));
    });

    await step.sendEvent("request-audio", {
      name: "briefing/audio.requested",
      data: { briefingId },
    });

    return { briefingId, signalCount: signalRows.length };
  },
);
