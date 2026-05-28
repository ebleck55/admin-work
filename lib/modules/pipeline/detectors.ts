/**
 * Pipeline signal detectors.
 *
 * Phase-1 scope: deterministic heuristics over structured claim attributes. Phase-3+ will
 * layer LLM-driven detectors on top (e.g., "is this email a churn signal?"). The detector
 * contract returns SignalCandidate[]; the dispatcher persists them and fires notifications.
 *
 * Detectors operate on the freshly written claims for a single payload — they don't sweep
 * the full ledger. Cross-payload patterns (e.g., "stage stagnant 30 days") will move to
 * cron-driven sweepers in a later phase.
 */

import type { SignalCandidate, SignalDetector } from "@/lib/modules/types";

const COMMITMENT_TOKENS = [
  "will deliver",
  "we'll send",
  "committed to",
  "deliver by",
  "agreed to send",
  "promised",
  "we commit",
  "by friday",
  "by eod",
  "next step",
];

const RISK_STAGES = new Set([
  "stalled",
  "no decision",
  "closed lost",
  "lost",
  "on hold",
  "deprioritized",
]);

const EXPANSION_TOKENS = [
  "expand",
  "additional license",
  "additional licenses",
  "additional seats",
  "new use case",
  "broaden scope",
  "land and expand",
  "upsell",
];

function containsAny(haystack: string, tokens: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const t of tokens) {
    if (lower.includes(t)) return t;
  }
  return null;
}

/** Flag claims whose statements describe explicit commitments Eric or his team made. */
export const detectCommitments: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const claim of ctx.claims) {
    const token = containsAny(claim.statement, COMMITMENT_TOKENS);
    if (!token) continue;
    out.push({
      kind: "commitment",
      severity: "medium",
      title: `Commitment: ${claim.statement.slice(0, 80)}`,
      summary: claim.statement,
      entityName: claim.entity_ref?.name,
      entityKind: claim.entity_ref?.kind,
      claimIds: [claim.id],
      attributes: { matched_token: token },
    });
  }
  return out;
};

/** Flag claims that report a stage indicating risk (lost, stalled, on-hold, etc.). */
export const detectStageRisk: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const claim of ctx.claims) {
    const attrs = claim.attributes ?? {};
    const stage = typeof attrs.stage === "string" ? attrs.stage.toLowerCase() : null;
    if (!stage) continue;
    if (!RISK_STAGES.has(stage)) continue;
    out.push({
      kind: "deal_risk",
      severity: stage.includes("lost") ? "high" : "medium",
      title: `Stage risk: ${claim.entity_ref?.name ?? "opportunity"} (${stage})`,
      summary: claim.statement,
      entityName: claim.entity_ref?.name,
      entityKind: claim.entity_ref?.kind,
      claimIds: [claim.id],
      attributes: { stage },
    });
  }
  return out;
};

/** Flag claims that signal expansion language. */
export const detectExpansion: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const claim of ctx.claims) {
    const token = containsAny(claim.statement, EXPANSION_TOKENS);
    if (!token) continue;
    out.push({
      kind: "expansion_opp",
      severity: "medium",
      title: `Expansion signal: ${claim.entity_ref?.name ?? "account"}`,
      summary: claim.statement,
      entityName: claim.entity_ref?.name,
      entityKind: claim.entity_ref?.kind,
      claimIds: [claim.id],
      attributes: { matched_token: token },
    });
  }
  return out;
};

export const PIPELINE_DETECTORS: SignalDetector[] = [
  detectCommitments,
  detectStageRisk,
  detectExpansion,
];
