import type { SignalCandidate, SignalDetector } from "@/lib/modules/types";

const BLOCKER_TOKENS = [
  "blocked",
  "blocker",
  "stalled",
  "waiting on",
  "dependency unresolved",
  "missed milestone",
  "behind schedule",
];

const MILESTONE_TOKENS = [
  "shipped",
  "launched",
  "delivered",
  "completed milestone",
  "hit the goal",
];

function findToken(text: string, tokens: string[]): string | null {
  const lower = text.toLowerCase();
  for (const t of tokens) if (lower.includes(t)) return t;
  return null;
}

export const detectInitiativeBlocker: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    if (c.entity_ref?.kind !== "initiative") continue;
    const tok = findToken(c.statement, BLOCKER_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "escalation",
      severity: "high",
      title: `Initiative blocked: ${c.entity_ref.name}`,
      summary: c.statement,
      entityName: c.entity_ref.name,
      entityKind: c.entity_ref.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const detectMilestone: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    if (c.entity_ref?.kind !== "initiative") continue;
    const tok = findToken(c.statement, MILESTONE_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "commitment",
      severity: "low",
      title: `Milestone: ${c.entity_ref.name}`,
      summary: c.statement,
      entityName: c.entity_ref.name,
      entityKind: c.entity_ref.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const INITIATIVES_DETECTORS: SignalDetector[] = [
  detectInitiativeBlocker,
  detectMilestone,
];
