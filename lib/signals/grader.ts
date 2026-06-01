/**
 * LLM-driven signal grader (Sonnet 4.6 via tool-use).
 *
 * Strategy: instead of asking the model to produce JSON in its text output and
 * parsing it post-hoc (fragile — fields drift, summaries overshoot length caps),
 * we declare a `report_signals` tool whose `input_schema` is the canonical
 * structured contract. Sonnet calls the tool with arguments that already
 * conform — that's the entire point of tool use for structured outputs.
 *
 * Cost: ~$0.01-0.02 per envelope. ~$5-10 to backfill 500 envelopes.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";
import { varietySeed } from "@/lib/prompts/variety";
import type { PayloadEnvelope, Claim } from "@/lib/ingestion/envelope";
import type { ModuleId, SignalCandidate } from "@/lib/modules/types";

const MODULE_IDS = [
  "pipeline",
  "cs",
  "team",
  "initiatives",
  "finserv",
  "competitive",
  "priorities",
  "comms",
] as const;

const SIGNAL_KINDS = [
  "deal_risk",
  "expansion_opp",
  "churn_indicator",
  "coaching_moment",
  "regulatory_signal",
  "competitive_mention",
  "commitment",
  "escalation",
] as const;

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

/**
 * Zod schema validates what the tool call delivered. Tool use makes structural
 * conformance very likely, but we still validate defensively.
 */
const GradedSignalSchema = z.object({
  module_id: z.enum(MODULE_IDS),
  kind: z.enum(SIGNAL_KINDS),
  severity: z.enum(SEVERITIES),
  title: z.string().min(1),
  summary: z.string().min(1),
  reasoning: z.string().min(1),
  claim_indices: z.array(z.number().int().nonnegative()).min(1),
});

const GraderResponseSchema = z.object({
  signals: z.array(GradedSignalSchema),
});

const REPORT_SIGNALS_TOOL: Anthropic.Tool = {
  name: "report_signals",
  description:
    "Report graded signals derived from the supplied claims. Call this exactly once. Pass an empty array if no claim crosses the bar for actionability.",
  input_schema: {
    type: "object",
    properties: {
      signals: {
        type: "array",
        description: "Curated, actionable signals only. Empty array is acceptable.",
        items: {
          type: "object",
          properties: {
            module_id: {
              type: "string",
              enum: [...MODULE_IDS],
              description: "Which COS module does this signal belong to?",
            },
            kind: {
              type: "string",
              enum: [...SIGNAL_KINDS],
              description: "Signal type. Use the closest match.",
            },
            severity: {
              type: "string",
              enum: [...SEVERITIES],
              description:
                "critical: blocker, regulator-driven deadline, immediate action. high: needs action this week. medium: worth knowing, not blocking. low: informational.",
            },
            title: {
              type: "string",
              description: "One-line headline, <= 180 chars. Lead with what changed or what's at risk.",
            },
            summary: {
              type: "string",
              description:
                "1-3 sentences explaining the signal. Cite specific entities, amounts, dates from the evidence. Avoid restating the title.",
            },
            reasoning: {
              type: "string",
              description:
                "Why this crossed the actionability bar (vs noise). Why this severity. <= 400 chars.",
            },
            claim_indices: {
              type: "array",
              items: { type: "integer", minimum: 0 },
              description: "Indices of the claims (from the supplied list) that contributed to this signal. At least one.",
            },
          },
          required: ["module_id", "kind", "severity", "title", "summary", "reasoning", "claim_indices"],
        },
      },
    },
    required: ["signals"],
  },
};

const SYSTEM_EXTRA = `
GRADING RULES:
- A claim becomes a signal ONLY if it would change what Eric does this week. "Pega is a competitor" is not a signal; "Customer cited Pega as the lead alternative they're evaluating" is.
- Suppress noise: stage-change claims at expected positions, vanilla financial fields with no anomaly, regulatory-term name-drops with no actual concern, commitments that are restatements of prior commitments.
- Group related claims into a single signal where appropriate.
- Use the report_signals tool exactly once. Empty signals array is fine if nothing crosses the bar.
`.trim();

export interface GradeInput {
  envelope: PayloadEnvelope;
  claims: Array<Claim & { id: string }>;
}

function buildUserPrompt(input: GradeInput): string {
  const { envelope, claims } = input;
  const claimLines = claims
    .map((c, i) => {
      const ref = c.entity_ref ? ` [${c.entity_ref.kind}: ${c.entity_ref.name}]` : "";
      const attrs =
        c.attributes && Object.keys(c.attributes).length > 0
          ? ` attrs=${JSON.stringify(c.attributes)}`
          : "";
      return `${i}: ${c.statement}${ref}${attrs}`;
    })
    .join("\n");

  const ctx = [
    `Source: ${envelope.source_system}`,
    envelope.actor ? `Actor: ${envelope.actor}` : null,
    envelope.title ? `Title: ${envelope.title}` : null,
    `Sensitivity: ${envelope.sensitivity}`,
    `Timestamp: ${envelope.source_timestamp}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const rawSnippet = envelope.raw_text
    ? `\n\nRAW TEXT (first 1500 chars):\n${envelope.raw_text.slice(0, 1500)}`
    : "";

  return `${ctx}\n\nCLAIMS:\n${claimLines}${rawSnippet}\n\nCall report_signals with the curated list. Return an empty signals array if no claim crosses the actionability bar.`;
}

export async function gradeEnvelope(input: GradeInput): Promise<SignalCandidate[]> {
  if (input.claims.length === 0) return [];

  let result;
  try {
    result = await callClaude({
      modelKey: "sonnet46",
      system: systemPromptFor({ mode: "extract", extra: `${SYSTEM_EXTRA}\n\n${varietySeed()}` }),
      cacheSystem: true,
      prompt: buildUserPrompt(input),
      maxTokens: 4096,
      purpose: "signal-grader",
      tools: [REPORT_SIGNALS_TOOL],
      toolChoice: { type: "tool", name: "report_signals" },
    });
  } catch (err) {
    console.error("[grader] API failed:", err instanceof Error ? err.message : err);
    return [];
  }

  // Find the report_signals tool call
  const toolCall = result.toolUseCalls.find((t) => t.name === "report_signals");
  if (!toolCall) {
    console.error("[grader] no report_signals tool call in response");
    return [];
  }

  const parsed = GraderResponseSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    console.error("[grader] zod validation failed:", parsed.error.issues.slice(0, 3));
    return [];
  }

  const candidates: SignalCandidate[] = [];
  for (const g of parsed.data.signals) {
    const linkedClaimIds = g.claim_indices
      .filter((i) => i < input.claims.length)
      .map((i) => input.claims[i].id);
    if (linkedClaimIds.length === 0) continue;

    const firstClaim = input.claims[g.claim_indices[0]];
    candidates.push({
      kind: g.kind,
      severity: g.severity,
      title: g.title.slice(0, 200),
      summary: g.summary.slice(0, 1000),
      entityName: firstClaim?.entity_ref?.name,
      entityKind: firstClaim?.entity_ref?.kind,
      claimIds: linkedClaimIds,
      attributes: { reasoning: g.reasoning, module_id_graded: g.module_id },
    });
  }
  return candidates;
}

export { type ModuleId };
