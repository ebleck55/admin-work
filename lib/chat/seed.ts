/**
 * Seed-context loader for chat conversations. When a conversation is created
 * "from" a situation/signal/account/meeting, we hydrate a rich context block
 * once and store it on the conversation; every assistant turn in that
 * conversation includes the seed in its system context.
 */

import { desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export type SeedKind = "situation" | "signal" | "account" | "meeting";

export async function loadSeedContext(
  kind: SeedKind,
  id: string,
): Promise<{ title: string; context: string } | null> {
  const database = db();
  switch (kind) {
    case "situation": {
      const rows = await database
        .select()
        .from(schema.situations)
        .where(eq(schema.situations.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      const sit = rows[0];

      // Pull the contributing signal titles
      const sigIds = sit.signalIds as string[];
      const sigs =
        sigIds.length > 0
          ? await database
              .select({
                title: schema.signals.title,
                summary: schema.signals.summary,
                kind: schema.signals.kind,
                severity: schema.signals.severity,
              })
              .from(schema.signals)
              .where(inArray(schema.signals.id, sigIds))
          : [];

      const entityName = sit.entityId
        ? (
            await database
              .select({ name: schema.entities.name })
              .from(schema.entities)
              .where(eq(schema.entities.id, sit.entityId))
              .limit(1)
          )[0]?.name ?? null
        : null;

      const ctx = [
        `SITUATION CONTEXT — discussing this situation with Eric. Maintain conversational continuity across turns.`,
        `Title: ${sit.title}`,
        entityName ? `Account: ${entityName}` : null,
        `Severity: ${sit.severity}`,
        `Status: ${sit.status}`,
        `Narrative:\n${sit.narrativeMd}`,
        `Why it matters:\n${sit.reasoningMd}`,
        sit.recommendedAction ? `Recommended action: ${sit.recommendedAction}` : null,
        sigs.length > 0
          ? `Contributing signals (${sigs.length}):\n${sigs
              .map((s) => `- [${s.severity} ${s.kind}] ${s.title}: ${s.summary}`)
              .join("\n")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      return { title: `Discussion: ${sit.title}`, context: ctx };
    }
    case "signal": {
      const rows = await database
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      const sig = rows[0];
      return {
        title: `Signal: ${sig.title}`,
        context: `SIGNAL CONTEXT.\nTitle: ${sig.title}\nKind: ${sig.kind}\nSeverity: ${sig.severity}\nSummary: ${sig.summary}`,
      };
    }
    case "account": {
      const rows = await database
        .select()
        .from(schema.entities)
        .where(eq(schema.entities.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      const acc = rows[0];

      const recentSignals = await database
        .select({
          title: schema.signals.title,
          summary: schema.signals.summary,
          kind: schema.signals.kind,
          severity: schema.signals.severity,
        })
        .from(schema.signals)
        .where(eq(schema.signals.entityId, id))
        .orderBy(desc(schema.signals.detectedAt))
        .limit(10);

      return {
        title: `Discussion: ${acc.name}`,
        context: `ACCOUNT CONTEXT — discussing ${acc.name}.\nExternal ID: ${acc.externalId ?? "n/a"}\n${
          recentSignals.length > 0
            ? `Recent signals:\n${recentSignals
                .map((s) => `- [${s.severity} ${s.kind}] ${s.title}: ${s.summary}`)
                .join("\n")}`
            : "No recent signals."
        }`,
      };
    }
    case "meeting": {
      const rows = await database
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      const evt = rows[0];
      return {
        title: `Meeting prep: ${evt.title}`,
        context: `MEETING PREP CONTEXT.\nTitle: ${evt.title}\nWhen: ${new Date(evt.startAt).toLocaleString()}\n${
          evt.prepBriefingMd
            ? `Existing prep brief:\n${evt.prepBriefingMd}`
            : "No prep brief generated yet."
        }`,
      };
    }
  }
}
