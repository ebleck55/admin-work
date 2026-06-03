/**
 * Phase 13d: load durable preference context for any LLM generation surface.
 *
 * Returns a stitched system-prompt block carrying:
 *   1. The single `user_preferences` row → "OPERATING PREFERENCES" section
 *      (always small + deterministic; safe to always inject)
 *   2. Last 30d feedback rows where valence ∈ {down, not_relevant} and
 *      reasonText non-null, deduplicated → "WHAT NOT TO SURFACE"
 *   3. Top-5 memory_facts where kind='preference' ordered by weight DESC,
 *      lastReferencedAt DESC NULLS LAST → "LEARNED PREFERENCES"
 *
 * Phase 15 will replace #3 with embedding-similarity retrieval against the
 * candidate cluster, but the simple top-K version is good enough until the
 * preference corpus grows past ~20 facts.
 *
 * Returns "" (empty string) if nothing meaningful exists yet — the caller can
 * safely append unconditionally.
 */

import { and, desc, gte, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export type PreferenceScope = "synthesis" | "brief" | "chat";

const FEEDBACK_WINDOW_DAYS = 30;
const MAX_FEEDBACK_RULES = 12;
const MAX_LEARNED_FACTS = 5;

export async function loadPreferenceContext(scope: PreferenceScope): Promise<string> {
  const database = db();
  const parts: string[] = [];

  // 1. Operating preferences
  try {
    const prefRows = await database
      .select()
      .from(schema.userPreferences)
      .limit(1);
    const prefs = prefRows[0];
    if (prefs) {
      const lines: string[] = [];
      if (prefs.minimumDealAmount && prefs.minimumDealAmount > 0) {
        lines.push(
          `- Suppress signals/situations about deals under $${Math.round(prefs.minimumDealAmount).toLocaleString()}.`,
        );
      }
      if (prefs.focusModules && prefs.focusModules.length > 0) {
        lines.push(`- Eric currently focuses on: ${prefs.focusModules.join(", ")}.`);
      }
      if (prefs.preferredBriefingStyle && scope === "brief") {
        lines.push(`- Preferred briefing style: ${prefs.preferredBriefingStyle}.`);
      }
      if (prefs.notes && prefs.notes.trim().length > 0) {
        lines.push(`- ${prefs.notes.trim()}`);
      }
      if (lines.length > 0) {
        parts.push(`OPERATING PREFERENCES (always respect):\n${lines.join("\n")}`);
      }
    }
  } catch {
    // Preferences absent or table missing — fall through
  }

  // 2. Recent rejection reasons (don't surface things like X)
  try {
    const since = new Date(Date.now() - FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rejections = await database
      .select({
        valence: schema.feedback.valence,
        reasonCategory: schema.feedback.reasonCategory,
        reasonText: schema.feedback.reasonText,
      })
      .from(schema.feedback)
      .where(
        and(
          gte(schema.feedback.createdAt, since),
          sql`${schema.feedback.valence} IN ('down','not_relevant')`,
          isNotNull(schema.feedback.reasonCategory),
        ),
      )
      .orderBy(desc(schema.feedback.createdAt))
      .limit(MAX_FEEDBACK_RULES * 2);

    const dedup = new Set<string>();
    const rules: string[] = [];
    for (const r of rejections) {
      const key = `${r.reasonCategory}:${r.reasonText ?? ""}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      const text = r.reasonText
        ? `${r.reasonCategory} — ${r.reasonText.slice(0, 200)}`
        : (r.reasonCategory ?? "(no reason)");
      rules.push(`- ${text}`);
      if (rules.length >= MAX_FEEDBACK_RULES) break;
    }
    if (rules.length > 0) {
      parts.push(`WHAT NOT TO SURFACE (recent rejections):\n${rules.join("\n")}`);
    }
  } catch {
    // Feedback table empty/unavailable — fall through
  }

  // 3. Learned preferences from memory_facts
  try {
    const learned = await database
      .select({
        text: schema.memoryFacts.text,
        kind: schema.memoryFacts.kind,
        weight: schema.memoryFacts.weight,
        lastReferencedAt: schema.memoryFacts.lastReferencedAt,
      })
      .from(schema.memoryFacts)
      .where(sql`${schema.memoryFacts.kind} = 'preference'`)
      .orderBy(
        desc(schema.memoryFacts.weight),
        sql`${schema.memoryFacts.lastReferencedAt} DESC NULLS LAST`,
      )
      .limit(MAX_LEARNED_FACTS);
    if (learned.length > 0) {
      parts.push(
        `LEARNED PREFERENCES (durable; honor these unless evidence directly contradicts):\n${learned
          .map((m) => `- ${m.text}`)
          .join("\n")}`,
      );
    }
  } catch {
    // Memory facts absent — fall through
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

/**
 * Capture which memory_facts contributed to a generation. Persisted on the
 * downstream entity (situation/briefing) for provenance display (Phase 15c).
 */
export async function getInfluencingPreferenceFactIds(): Promise<string[]> {
  try {
    const rows = await db()
      .select({ id: schema.memoryFacts.id })
      .from(schema.memoryFacts)
      .where(sql`${schema.memoryFacts.kind} = 'preference'`)
      .orderBy(
        desc(schema.memoryFacts.weight),
        sql`${schema.memoryFacts.lastReferencedAt} DESC NULLS LAST`,
      )
      .limit(MAX_LEARNED_FACTS);
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}
