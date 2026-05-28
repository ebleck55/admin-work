/**
 * Three-tier safety filter.
 *
 * Adapted from `bart-app/learning-quest/lib/topicFilter.ts` + `responseFilter.ts` and the
 * same files in `learning-quest-grade5/`. The learning apps gate child-safety topics; we
 * repurpose the structure for:
 *   Tier 1 (input gate):   PII redaction on raw text before storage.
 *   Tier 2 (in-prompt):    System-prompt clauses that forbid invention of customer facts.
 *   Tier 3 (output gate):  Reject signals/briefings that include private_dm content unless
 *                          the caller has explicitly opted in.
 */

import type { Sensitivity } from "@/lib/ingestion/envelope";

// ---------------------------------------------------------------------------
// Tier 1 — PII redaction (deterministic regex)
// ---------------------------------------------------------------------------

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    name: "us_ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED:SSN]",
  },
  {
    // Generic 13-19 digit run with optional dashes/spaces — credit-card-ish.
    name: "credit_card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[REDACTED:CARD]",
  },
  {
    name: "email_internal_pii",
    // Don't redact normal corporate emails; only obvious private personal IDs.
    pattern: /\b\d{9,12}@\w+\b/g,
    replacement: "[REDACTED:ID]",
  },
];

export interface RedactionResult {
  text: string;
  redactions: Array<{ rule: string; count: number }>;
}

export function redactPii(input: string): RedactionResult {
  let text = input;
  const redactions: Array<{ rule: string; count: number }> = [];
  for (const rule of REDACTION_RULES) {
    let count = 0;
    text = text.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });
    if (count > 0) redactions.push({ rule: rule.name, count });
  }
  return { text, redactions };
}

// ---------------------------------------------------------------------------
// Tier 2 — in-prompt clauses (returned as text, appended by the prompt builder)
// ---------------------------------------------------------------------------

export const GROUNDING_CLAUSES = `
GROUNDING RULES (must follow):
- Never invent customer names, deal amounts, dates, or quotes that do not appear in the supplied evidence.
- When uncertain, say "evidence does not specify" instead of guessing.
- Cite each non-trivial claim with the evidence ID (format: [evidence #id]) it came from.
- If asked about something not covered by the evidence, say so explicitly.
`.trim();

export const SENSITIVITY_CLAUSES = `
SENSITIVITY RULES:
- Content marked sensitivity:"private_dm" is from Eric's private Slack DMs. Do not include any private_dm content in any artifact that might be shared with another person (e.g., briefings flagged shareable=true, exec comms drafts).
- Private DM content may inform Eric's personal feed only.
- If a useful insight is supported only by private_dm evidence, surface it in the personal feed and explicitly note its private origin; do not propagate it to shareable outputs.
`.trim();

// ---------------------------------------------------------------------------
// Tier 3 — output-eligibility check
// ---------------------------------------------------------------------------

export interface OutputContext {
  /** True if this artifact may be shared with another user. */
  shareable: boolean;
  /** Sensitivities of every evidence/claim/signal used to produce this output. */
  contributingSensitivities: Sensitivity[];
}

export interface OutputCheck {
  allowed: boolean;
  reason?: string;
}

export function checkOutputEligibility(ctx: OutputContext): OutputCheck {
  if (!ctx.shareable) return { allowed: true };
  if (ctx.contributingSensitivities.includes("private_dm")) {
    return {
      allowed: false,
      reason: "Output is marked shareable but contains private_dm evidence.",
    };
  }
  return { allowed: true };
}
