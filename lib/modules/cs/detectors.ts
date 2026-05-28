import type { SignalCandidate, SignalDetector } from "@/lib/modules/types";

const HEALTH_RISK_TOKENS = [
  "considering alternatives",
  "looking at other vendors",
  "frustrated",
  "disappointed",
  "not seeing value",
  "rip and replace",
  "evaluating competitors",
  "may not renew",
];

const ESCALATION_TOKENS = [
  "urgent",
  "escalate",
  "executive escalation",
  "ceo asked",
  "blocker for us",
  "still waiting",
  "missed the deadline",
];

const EXPANSION_TOKENS = [
  "expand",
  "additional licenses",
  "new use case",
  "new business unit",
  "broaden scope",
  "department-wide rollout",
];

function findToken(text: string, tokens: string[]): string | null {
  const lower = text.toLowerCase();
  for (const t of tokens) if (lower.includes(t)) return t;
  return null;
}

export const detectHealthRisk: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    const tok = findToken(c.statement, HEALTH_RISK_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "churn_indicator",
      severity: "high",
      title: `Health risk: ${c.entity_ref?.name ?? "account"}`,
      summary: c.statement,
      entityName: c.entity_ref?.name,
      entityKind: c.entity_ref?.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const detectEscalation: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    const tok = findToken(c.statement, ESCALATION_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "escalation",
      severity: "high",
      title: `Escalation signal: ${c.entity_ref?.name ?? "account"}`,
      summary: c.statement,
      entityName: c.entity_ref?.name,
      entityKind: c.entity_ref?.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const detectExpansion: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    const tok = findToken(c.statement, EXPANSION_TOKENS);
    if (!tok) continue;
    out.push({
      kind: "expansion_opp",
      severity: "medium",
      title: `Expansion: ${c.entity_ref?.name ?? "account"}`,
      summary: c.statement,
      entityName: c.entity_ref?.name,
      entityKind: c.entity_ref?.kind,
      claimIds: [c.id],
      attributes: { matched_token: tok },
    });
  }
  return out;
};

export const CS_DETECTORS: SignalDetector[] = [
  detectHealthRisk,
  detectEscalation,
  detectExpansion,
];
