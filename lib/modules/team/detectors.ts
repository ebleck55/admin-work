import type { SignalCandidate, SignalDetector } from "@/lib/modules/types";

const COACHING_TOKENS = [
  "stuck on",
  "asked twice",
  "missed the step",
  "couldn't answer",
  "wasn't prepared",
  "didn't follow up",
  "lost the thread",
  "needs coaching",
];

const COMMITMENT_TOKENS = [
  "committed to",
  "will deliver",
  "will follow up",
  "agreed to send",
];

function findToken(text: string, tokens: string[]): string | null {
  const lower = text.toLowerCase();
  for (const t of tokens) if (lower.includes(t)) return t;
  return null;
}

export const detectCoaching: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    const tok = findToken(c.statement, COACHING_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "coaching_moment",
      severity: "medium",
      title: `Coaching: ${c.entity_ref?.name ?? "rep"}`,
      summary: c.statement,
      entityName: c.entity_ref?.name,
      entityKind: c.entity_ref?.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const detectRepCommitment: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    // Only flag if entity is a rep
    if (c.entity_ref?.kind !== "rep") continue;
    const tok = findToken(c.statement, COMMITMENT_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "commitment",
      severity: "medium",
      title: `Rep commitment: ${c.entity_ref.name}`,
      summary: c.statement,
      entityName: c.entity_ref.name,
      entityKind: c.entity_ref.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const TEAM_DETECTORS: SignalDetector[] = [detectCoaching, detectRepCommitment];
