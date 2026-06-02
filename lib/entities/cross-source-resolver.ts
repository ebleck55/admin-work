/**
 * Cross-source entity resolution. Beyond what lib/entities/normalize.ts does
 * (deterministic suffix-stripping + tier-2 first-word match), this calls
 * Sonnet 4.6 with tool-use to identify entity groups that refer to the same
 * real-world thing across data sources.
 *
 * Example: "Aurora Bank" (Codex from email domain) vs "Aurora Financial
 * Services" (Salesforce canonical) — same company, normalize() doesn't
 * collapse them, LLM resolution should.
 *
 * Runs as a daily Inngest function. After merges land, claims and signals
 * follow the canonical entity_id (same FK update pattern as the deterministic
 * dedupe script).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { callClaude } from "@/lib/llm/anthropic";
import { db, schema } from "@/lib/db/client";
import { systemPromptFor } from "@/lib/prompts/system";
import { eq } from "drizzle-orm";

interface ResolverInput {
  candidates: Array<{ id: string; name: string; kind: string; externalId: string | null }>;
}

const MergeGroupSchema = z.object({
  canonical_id: z.string().uuid(),
  merge_ids: z.array(z.string().uuid()).min(1),
  reason: z.string().min(1),
});

const ResolverResponseSchema = z.object({
  merges: z.array(MergeGroupSchema).default([]),
});

const RESOLVE_TOOL: Anthropic.Tool = {
  name: "report_entity_merges",
  description:
    "Report groups of entity IDs that refer to the same real-world entity. Only include high-confidence merges.",
  input_schema: {
    type: "object",
    properties: {
      merges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            canonical_id: {
              type: "string",
              description: "UUID of the entity that should be the canonical (longer/richer name).",
            },
            merge_ids: {
              type: "array",
              items: { type: "string" },
              description: "UUIDs of entities to merge INTO the canonical.",
            },
            reason: {
              type: "string",
              description: "Why these match. <= 200 chars.",
            },
          },
          required: ["canonical_id", "merge_ids", "reason"],
        },
      },
    },
    required: ["merges"],
  },
};

const SYSTEM_EXTRA = `
ENTITY RESOLUTION RULES:
- Only merge if you're 95%+ confident they're the same real-world entity. When in doubt, don't merge.
- "Aurora Bank" (Codex email-domain inference) + "Aurora Financial Services" (Salesforce) likely same.
- "Capital Group" + "Capital One" — different, don't merge.
- "Chubb" + "Chubb INA Holdings Inc." — already handled by deterministic normalize.
- Look for: domain overlap, subsidiary relationships ("X Holdings" parent of "X Bank"), known acronyms ("TD" for "Toronto-Dominion Bank").
- Canonical pick: longer name preferred (more specific).
- Use report_entity_merges exactly once.
`.trim();

export async function resolveCrossSource(input: ResolverInput) {
  if (input.candidates.length < 2) return { merges: [] };

  const candidateLines = input.candidates
    .map(
      (c) =>
        `${c.id} | ${c.kind} | "${c.name}"${c.externalId ? ` | ext_id=${c.externalId}` : ""}`,
    )
    .join("\n");

  let result;
  try {
    result = await callClaude({
      modelKey: "sonnet46",
      system: systemPromptFor({ mode: "verify", extra: SYSTEM_EXTRA }),
      cacheSystem: true,
      prompt: `Candidate entities (id | kind | name | external_id?):\n${candidateLines}\n\nReport any groups that refer to the same real-world entity.`,
      maxTokens: 2000,
      purpose: "cross-source-resolver",
      tools: [RESOLVE_TOOL],
      toolChoice: { type: "tool", name: "report_entity_merges" },
    });
  } catch (err) {
    console.error("[cross-source-resolver] failed:", err instanceof Error ? err.message : err);
    return { merges: [] };
  }

  const toolCall = result.toolUseCalls.find((t) => t.name === "report_entity_merges");
  if (!toolCall) return { merges: [] };
  const parsed = ResolverResponseSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    console.error("[cross-source-resolver] zod failed:", parsed.error.issues.slice(0, 3));
    return { merges: [] };
  }
  return parsed.data;
}

export async function applyMerges(
  merges: Array<{ canonical_id: string; merge_ids: string[] }>,
): Promise<{ applied: number; skipped: number }> {
  const { inArray } = await import("drizzle-orm");
  let applied = 0;
  let skipped = 0;
  for (const m of merges) {
    if (m.merge_ids.includes(m.canonical_id)) {
      skipped += 1;
      continue;
    }
    await db()
      .update(schema.claims)
      .set({ entityId: m.canonical_id })
      .where(inArray(schema.claims.entityId, m.merge_ids));
    await db()
      .update(schema.signals)
      .set({ entityId: m.canonical_id })
      .where(inArray(schema.signals.entityId, m.merge_ids));
    await db()
      .update(schema.situations)
      .set({ entityId: m.canonical_id })
      .where(inArray(schema.situations.entityId, m.merge_ids));
    await db().delete(schema.entities).where(inArray(schema.entities.id, m.merge_ids));
    applied += 1;
  }
  void eq;
  return { applied, skipped };
}
