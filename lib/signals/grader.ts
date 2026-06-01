/**
 * LLM-driven signal grader.
 *
 * The Phase-1 detectors are keyword heuristics — they fire on any "Pega" mention
 * regardless of whether the email said "we lost to Pega" or "we beat Pega". That
 * floods dashboards with low-value signals.
 *
 * This grader takes an envelope + its claims and asks Sonnet 4.6:
 *   "Given the full context, which of these are signals Eric actually needs to
 *    see? What kind? What severity? Why?"
 *
 * One call per envelope (not per claim), keeping cost predictable: ~$0.01-0.02
 * per envelope at typical sizes.
 *
 * Output is structured JSON validated by Zod. Failures are non-fatal — the
 * pipeline continues with no signals for the bad envelope.
 */

import { z } from "zod";

import { callClaudeWithRetry } from "@/lib/llm/retry";
import { systemPromptFor } from "@/lib/prompts/system";
import { varietySeed } from "@/lib/prompts/variety";
import type { PayloadEnvelope, Claim } from "@/lib/ingestion/envelope";
import type { ModuleId, SignalCandidate } from "@/lib/modules/types";

const GradedSignalSchema = z.object({
  module_id: z.enum([
    "pipeline",
    "cs",
    "team",
    "initiatives",
    "finserv",
    "competitive",
    "priorities",
    "comms",
  ]),
  kind: z.enum([
    "deal_risk",
    "expansion_opp",
    "churn_indicator",
    "coaching_moment",
    "regulatory_signal",
    "competitive_mention",
    "commitment",
    "escalation",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(500),
  reasoning: z.string().min(1).max(500),
  claim_indices: z.array(z.number().int().nonnegative()).min(1),
});

const GraderResponseSchema = z.object({
  signals: z.array(GradedSignalSchema),
});

type GradedSignal = z.infer<typeof GradedSignalSchema>;

export interface GradeInput {
  envelope: PayloadEnvelope;
  claims: Array<Claim & { id: string }>;
}

const SYSTEM_EXTRA = `
GRADING RULES:
- A claim becomes a signal ONLY if it would change what Eric does this week. "Pega is a competitor" is not a signal; "Customer cited Pega as the lead alternative they're evaluating" is.
- Suppress noise: stage-change claims for deals at expected positions, generic financial fields with no anomaly, regulatory-term name-drops with no actual concern, commitments that are restatements of prior commitments.
- Severity calibration:
    critical = immediate action required (escalation from CEO, blocker for board prep, regulator-driven deadline)
    high     = needs action this week (churn risk surfaced, deal slipping, committed deliverable due in days)
    medium   = worth knowing but not blocking (expansion mention, generic regulatory signal, competitive mention)
    low      = informational (background context, weak signals)
- Group related claims into a single signal where appropriate. Cite the claim_indices that contributed.
- Output ONLY a JSON object: { "signals": [ ... ] }. No prose, no markdown fences.
- If no claim crosses the bar, return { "signals": [] }.
`.trim();

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

  return `${ctx}

CLAIMS:
${claimLines}${rawSnippet}

Grade these claims per the rules. Output JSON only.`;
}

export async function gradeEnvelope(input: GradeInput): Promise<SignalCandidate[]> {
  if (input.claims.length === 0) return [];

  const result = await callClaudeWithRetry({
    modelKey: "sonnet46",
    system: systemPromptFor({ mode: "extract", extra: `${SYSTEM_EXTRA}\n\n${varietySeed()}` }),
    cacheSystem: true,
    prompt: buildUserPrompt(input),
    maxTokens: 1500,
    purpose: "signal-grader",
    schema: GraderResponseSchema,
    maxRetries: 1,
  }).catch((err) => {
    console.error("[grader] failed:", err instanceof Error ? err.message : err);
    return { signals: [] as GradedSignal[] };
  });

  const candidates: SignalCandidate[] = [];
  for (const g of result.signals) {
    const linkedClaimIds = g.claim_indices
      .filter((i) => i < input.claims.length)
      .map((i) => input.claims[i].id);
    if (linkedClaimIds.length === 0) continue;

    // Best-effort entity: take the entity_ref from the first contributing claim
    const firstClaim = input.claims[g.claim_indices[0]];
    candidates.push({
      kind: g.kind,
      severity: g.severity,
      title: g.title,
      summary: g.summary,
      entityName: firstClaim?.entity_ref?.name,
      entityKind: firstClaim?.entity_ref?.kind,
      claimIds: linkedClaimIds,
      attributes: { reasoning: g.reasoning, module_id_graded: g.module_id },
    });
  }
  return candidates;
}

export { type ModuleId, type GradedSignal };
