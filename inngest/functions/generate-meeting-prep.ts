/**
 * Pre-meeting prep generator.
 *
 * Triggered by `calendar/meeting.prep.requested`. For a given calendar event,
 * pulls relevant context — account signals, claims about attendees from the
 * last 90 days, open situations involving the account — and synthesizes a
 * tight pre-meeting brief via Opus 4.7.
 *
 * Output lands in `calendar_events.prep_briefing_md` + sets
 * `prep_synthesized_at`. The home page renders the brief inline when present.
 *
 * Cost: ~$0.03/meeting. Budget ~10 meetings/day = $9/month.
 */

import { and, desc, eq, gte, inArray, or } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";
import { varietySeed } from "@/lib/prompts/variety";

const CLAIM_WINDOW_DAYS = 90;
const MAX_CLAIMS = 30;
const MAX_SITUATIONS = 5;

export const generateMeetingPrep = inngest.createFunction(
  {
    id: "generate-meeting-prep",
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: "calendar/meeting.prep.requested" },
  async ({ event, step }) => {
    const { calendarEventId } = event.data;

    const evt = await step.run("load-event", async () => {
      const rows = await db()
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, calendarEventId))
        .limit(1);
      if (rows.length === 0) throw new Error(`calendar event ${calendarEventId} not found`);
      return rows[0];
    });

    // Skip if prep is already fresh (within 6h)
    const prepTs = evt.prepSynthesizedAt
      ? new Date(evt.prepSynthesizedAt as unknown as string | Date).getTime()
      : 0;
    if (
      evt.prepBriefingMd &&
      prepTs > 0 &&
      Date.now() - prepTs < 6 * 60 * 60 * 1000
    ) {
      return { skipped: "prep_fresh" };
    }

    // Load context: claims about linked accounts + open situations + attendee mentions
    const ctx = await step.run("load-context", async () => {
      const accountIds = evt.accountEntityIds as string[];
      const since = new Date(Date.now() - CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const accountClaims =
        accountIds.length > 0
          ? await db()
              .select({
                statement: schema.claims.statement,
                moduleId: schema.claims.moduleId,
                sourceSystem: schema.evidenceLedger.sourceSystem,
                sourceTimestamp: schema.evidenceLedger.sourceTimestamp,
              })
              .from(schema.claims)
              .leftJoin(
                schema.evidenceLedger,
                eq(schema.claims.ledgerId, schema.evidenceLedger.id),
              )
              .where(
                and(
                  inArray(schema.claims.entityId, accountIds),
                  gte(schema.evidenceLedger.sourceTimestamp, since),
                ),
              )
              .orderBy(desc(schema.evidenceLedger.sourceTimestamp))
              .limit(MAX_CLAIMS)
          : [];

      const sitConds = [
        or(
          eq(schema.situations.status, "open"),
          eq(schema.situations.status, "watching"),
          eq(schema.situations.status, "escalated"),
        ),
      ];
      if (accountIds.length > 0) {
        sitConds.push(inArray(schema.situations.entityId, accountIds));
      }
      const openSituations =
        accountIds.length > 0
          ? await db()
              .select({
                id: schema.situations.id,
                title: schema.situations.title,
                severity: schema.situations.severity,
                narrativeMd: schema.situations.narrativeMd,
                recommendedAction: schema.situations.recommendedAction,
              })
              .from(schema.situations)
              .where(and(...sitConds))
              .orderBy(desc(schema.situations.updatedAt))
              .limit(MAX_SITUATIONS)
          : [];

      const accountNames =
        accountIds.length > 0
          ? (
              await db()
                .select({ name: schema.entities.name })
                .from(schema.entities)
                .where(inArray(schema.entities.id, accountIds))
            ).map((r) => r.name)
          : [];

      return { accountClaims, openSituations, accountNames };
    });

    if (
      ctx.accountClaims.length === 0 &&
      ctx.openSituations.length === 0 &&
      (evt.accountEntityIds as string[]).length === 0
    ) {
      // No useful context to synthesize on — skip and let UI render the bare event
      await db()
        .update(schema.calendarEvents)
        .set({
          prepBriefingMd: null,
          prepSynthesizedAt: new Date(),
        })
        .where(eq(schema.calendarEvents.id, calendarEventId));
      return { skipped: "no_context" };
    }

    const attendees = (evt.attendees as Array<{ email?: string; name?: string; is_self?: boolean }>) ?? [];
    const externalAttendees = attendees.filter((a) => !a.is_self).map((a) => a.name ?? a.email).filter(Boolean);

    const startIso =
      typeof evt.startAt === "string"
        ? evt.startAt
        : new Date(evt.startAt as unknown as Date).toISOString();
    const endIso =
      typeof evt.endAt === "string"
        ? evt.endAt
        : new Date(evt.endAt as unknown as Date).toISOString();
    const prompt = `EVENT: ${evt.title}
WHEN: ${startIso} → ${endIso}
LOCATION: ${evt.location ?? "n/a"}
EXTERNAL ATTENDEES: ${externalAttendees.join(", ") || "none"}
LINKED ACCOUNTS: ${ctx.accountNames.join(", ") || "none"}

OPEN SITUATIONS FOR THESE ACCOUNTS:
${
  ctx.openSituations
    .map(
      (s) =>
        `[${s.severity}] ${s.title}\nNarrative: ${s.narrativeMd.slice(0, 240)}\nRecommended: ${s.recommendedAction ?? "n/a"}`,
    )
    .join("\n\n") || "(none)"
}

RECENT CLAIMS ABOUT THESE ACCOUNTS (last ${CLAIM_WINDOW_DAYS}d):
${
  ctx.accountClaims
    .map((c) => `- [${c.sourceSystem}] ${c.statement}`)
    .join("\n") || "(none)"
}

Produce a tight pre-meeting brief in markdown. Sections:
1. **What to know walking in** (2-3 bullets — the bottom line)
2. **Open issues to surface** (1-3 bullets, only the ones that matter for this meeting)
3. **Questions to ask** (1-3 bullets)
4. **Risks** (any landmines)

Keep it concise. <= 400 words total. Reference specific accounts/people/numbers.`;

    const { text } = await step.run("call-opus", async () =>
      callClaude({
        modelKey: "opus47",
        system: systemPromptFor({
          mode: "brief",
          extra: `You're producing pre-meeting prep for an SVP. Be specific. Surface only what changes the meeting outcome.\n\n${varietySeed()}`,
        }),
        cacheSystem: true,
        prompt,
        maxTokens: 2500,
        purpose: "meeting-prep",
      }),
    );

    await step.run("update-event", async () => {
      await db()
        .update(schema.calendarEvents)
        .set({
          prepBriefingMd: text,
          prepSynthesizedAt: new Date(),
        })
        .where(eq(schema.calendarEvents.id, calendarEventId));
    });

    return { calendarEventId, charsGenerated: text.length };
  },
);
