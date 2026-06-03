/**
 * Situation synthesizer (Opus 4.7 via tool-use).
 *
 * Phase 7+ unit: a situation wraps 1-N related signals with a narrative,
 * reasoning, recommended action, and optional decision frame. Higher signal-
 * to-noise than raw signal lists because situations group related claims
 * into a single coherent thread (e.g. "Meridian Trust is moving toward
 * churn" rather than three separate health-risk + escalation + competitive
 * signals).
 *
 * Called by `inngest/functions/synthesize-situations.ts` on a schedule and
 * after batches of new signals arrive.
 *
 * Cost: ~$0.05 per call (one Opus 4.7 turn over ~20 signals + existing
 * situations). Budget 3-5 calls/day = $5/month.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";
import { varietySeed } from "@/lib/prompts/variety";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "watching", "escalated", "resolved"] as const;

const DecisionFrameSchema = z.object({
  question: z.string().min(1),
  options: z
    .array(z.object({ label: z.string().min(1), tradeoff: z.string().min(1) }))
    .min(2)
    .max(4),
  recommendation: z.string().min(1),
  reasoning: z.string().min(1),
});

const NewSituationSchema = z.object({
  title: z.string().min(1),
  narrative_md: z.string().min(1),
  reasoning_md: z.string().min(1),
  recommended_action: z.string().optional(),
  severity: z.enum(SEVERITIES),
  status: z.enum(STATUSES).default("open"),
  contributing_signal_ids: z.array(z.string().uuid()).min(1),
  primary_entity_id: z.string().uuid().optional(),
  decision_frame: DecisionFrameSchema.optional(),
});

const UpdateSituationSchema = z.object({
  situation_id: z.string().uuid(),
  narrative_md: z.string().optional(),
  reasoning_md: z.string().optional(),
  recommended_action: z.string().optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(STATUSES).optional(),
  add_signal_ids: z.array(z.string().uuid()).optional(),
  decision_frame: DecisionFrameSchema.optional(),
});

const SynthesizerResponseSchema = z.object({
  new_situations: z.array(NewSituationSchema).default([]),
  updates: z.array(UpdateSituationSchema).default([]),
});

export type NewSituation = z.infer<typeof NewSituationSchema>;
export type UpdateSituation = z.infer<typeof UpdateSituationSchema>;
export type SynthesizerResponse = z.infer<typeof SynthesizerResponseSchema>;

const REPORT_SITUATIONS_TOOL: Anthropic.Tool = {
  name: "report_situation_updates",
  description:
    "Report synthesized situations. Create new situations for clusters of related signals that share a theme. Update existing situations with new evidence or changed status.",
  input_schema: {
    type: "object",
    properties: {
      new_situations: {
        type: "array",
        description: "Newly synthesized situations from ungrouped signals.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "Short, declarative headline. Lead with what changed or what's at stake. <= 120 chars.",
            },
            narrative_md: {
              type: "string",
              description:
                "2-5 sentence narrative explaining the situation. Cite specific entities, amounts, dates from the evidence. Markdown allowed.",
            },
            reasoning_md: {
              type: "string",
              description:
                "Why this matters now. What's at stake. What's the time pressure. <= 600 chars.",
            },
            recommended_action: {
              type: "string",
              description: "One-line recommended next action. Optional.",
            },
            severity: { type: "string", enum: [...SEVERITIES] },
            status: { type: "string", enum: [...STATUSES], default: "open" },
            contributing_signal_ids: {
              type: "array",
              items: { type: "string" },
              description: "UUIDs of signals that contribute to this situation.",
            },
            primary_entity_id: {
              type: "string",
              description: "UUID of the primary entity (account/opportunity/etc.). Optional.",
            },
            decision_frame: {
              type: "object",
              description:
                "Only include if the situation presents a clear decision with 2-4 options.",
              properties: {
                question: { type: "string" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      tradeoff: { type: "string" },
                    },
                    required: ["label", "tradeoff"],
                  },
                },
                recommendation: { type: "string" },
                reasoning: { type: "string" },
              },
              required: ["question", "options", "recommendation", "reasoning"],
            },
          },
          required: [
            "title",
            "narrative_md",
            "reasoning_md",
            "severity",
            "contributing_signal_ids",
          ],
        },
      },
      updates: {
        type: "array",
        description:
          "Updates to existing situations: new evidence to fold in, status changes, narrative refinements.",
        items: {
          type: "object",
          properties: {
            situation_id: { type: "string" },
            narrative_md: { type: "string" },
            reasoning_md: { type: "string" },
            recommended_action: { type: "string" },
            severity: { type: "string", enum: [...SEVERITIES] },
            status: { type: "string", enum: [...STATUSES] },
            add_signal_ids: { type: "array", items: { type: "string" } },
            decision_frame: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      tradeoff: { type: "string" },
                    },
                    required: ["label", "tradeoff"],
                  },
                },
                recommendation: { type: "string" },
                reasoning: { type: "string" },
              },
              required: ["question", "options", "recommendation", "reasoning"],
            },
          },
          required: ["situation_id"],
        },
      },
    },
    required: ["new_situations", "updates"],
  },
};

const SYSTEM_EXTRA = `
SYNTHESIS RULES:
- A situation is a coherent narrative about ONE thread of activity. Group related signals (same account, same theme, causally linked).
- Don't create one-signal situations unless that signal is genuinely standalone and important.
- Keep the active situation count low: aim for 5-12 total open situations across the business. Suppress, merge, or close marginal ones.
- Status: 'open' = needs Eric's attention this week. 'watching' = monitor but not urgent. 'escalated' = surfaced to top-priority. 'resolved' = no further attention needed.
- Severity: match the highest severity among contributing signals, downgrade if context suggests it's less urgent than the signal severity suggests.
- Decision frames: only include when the situation presents Eric with a clear choice between 2-4 paths. Most situations are observational and don't need a decision frame.
- Update existing situations preferentially over creating duplicates.
- When a situation has had no new signals in 14+ days, mark it 'resolved' as part of updates.
- Use the report_situation_updates tool exactly once.
`.trim();

export interface SynthesizeInput {
  /** Recent signals not yet attached to any situation. */
  ungroupedSignals: Array<{
    id: string;
    kind: string;
    severity: string;
    title: string;
    summary: string;
    moduleId: string | null;
    /** ISO 8601 string — Inngest steps serialize Date through JSON. */
    detectedAt: string;
    entity: { id: string; kind: string; name: string } | null;
  }>;
  /** Existing open/watching/escalated situations. */
  openSituations: Array<{
    id: string;
    title: string;
    narrativeMd: string;
    status: string;
    severity: string;
    signalIds: string[];
    entity: { id: string; kind: string; name: string } | null;
    lastSynthesizedAt: string | null;
  }>;
  /** Phase 13d preference-context block. Empty string when no prefs/feedback exist. */
  preferenceContext?: string;
}

function buildUserPrompt(input: SynthesizeInput): string {
  const sigLines = input.ungroupedSignals
    .map(
      (s) =>
        `${s.id} | ${s.severity} ${s.kind} | ${s.title} | entity: ${s.entity ? `${s.entity.kind}=${s.entity.name}` : "none"} | summary: ${s.summary}`,
    )
    .join("\n");

  const sitLines =
    input.openSituations.length > 0
      ? input.openSituations
          .map(
            (s) =>
              `${s.id} | ${s.status}/${s.severity} | ${s.title} | entity: ${s.entity?.name ?? "none"} | signals: ${s.signalIds.length} | narrative: ${s.narrativeMd.slice(0, 180)}…`,
          )
          .join("\n")
      : "(none)";

  return `UNGROUPED SIGNALS (most recent first):
${sigLines || "(none)"}

EXISTING OPEN SITUATIONS:
${sitLines}

Synthesize. Group related ungrouped signals into new situations OR fold them into existing ones via the updates array. Aim for high signal-to-noise: 5-12 total open situations is the target.`;
}

export async function synthesize(
  input: SynthesizeInput,
): Promise<SynthesizerResponse> {
  // Trivial early return when there's nothing to do
  if (input.ungroupedSignals.length === 0 && input.openSituations.length === 0) {
    return { new_situations: [], updates: [] };
  }

  const systemExtra = input.preferenceContext
    ? `${SYSTEM_EXTRA}\n\n${input.preferenceContext}\n\n${varietySeed()}`
    : `${SYSTEM_EXTRA}\n\n${varietySeed()}`;

  let result;
  try {
    result = await callClaude({
      modelKey: "opus47",
      system: systemPromptFor({ mode: "brief", extra: systemExtra }),
      cacheSystem: true,
      prompt: buildUserPrompt(input),
      maxTokens: 6000,
      purpose: "situation-synthesizer",
      tools: [REPORT_SITUATIONS_TOOL],
      toolChoice: { type: "tool", name: "report_situation_updates" },
    });
  } catch (err) {
    console.error("[synthesizer] call failed:", err instanceof Error ? err.message : err);
    return { new_situations: [], updates: [] };
  }

  const toolCall = result.toolUseCalls.find((t) => t.name === "report_situation_updates");
  if (!toolCall) {
    console.error("[synthesizer] no report_situation_updates tool call in response");
    return { new_situations: [], updates: [] };
  }

  const parsed = SynthesizerResponseSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    console.error("[synthesizer] zod validation failed:", parsed.error.issues.slice(0, 3));
    return { new_situations: [], updates: [] };
  }

  return parsed.data;
}
