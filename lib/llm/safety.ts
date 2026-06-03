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

// NOTE: regex redaction is best-effort defense-in-depth only. It cannot catch names,
// addresses, account numbers, or most MNPI. The real PII control is the access gate in front
// of the deployment (Vercel Password Protection) + restricted DB access — see SETUP.md.
const REDACTION_RULES: RedactionRule[] = [
  {
    name: "us_ssn",
    // Allow dashed, spaced, or run-together SSNs (123-45-6789 / 123 45 6789 / 123456789).
    pattern: /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g,
    replacement: "[REDACTED:SSN]",
  },
  {
    // 13-19 digit run with optional single separators between groups — credit-card-ish.
    name: "credit_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
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

/**
 * Fail-closed enforcement of the Tier-3 gate at the row level. Given a list of
 * sensitivity-tagged items destined for a shareable artifact, removes any `private_dm` item
 * and returns the kept + dropped partitions so the caller can log the drop. When the artifact
 * is not shareable, everything is kept. This is the runtime counterpart to
 * `checkOutputEligibility` — call it on the evidence/signals/situations that feed any
 * artifact that could be shared with another person.
 */
export function dropIneligible<T extends { sensitivity?: Sensitivity | null }>(
  items: T[],
  ctx: { shareable: boolean },
): { kept: T[]; dropped: T[] } {
  if (!ctx.shareable) return { kept: items, dropped: [] };
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (item.sensitivity === "private_dm") dropped.push(item);
    else kept.push(item);
  }
  return { kept, dropped };
}
