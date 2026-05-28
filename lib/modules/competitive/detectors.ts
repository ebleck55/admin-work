import type { SignalCandidate, SignalDetector } from "@/lib/modules/types";

const COMPETITORS = [
  "salesforce",
  "microsoft",
  "pega",
  "automation anywhere",
  "blue prism",
  "uipath", // self-mention can also be useful context
  "appian",
  "workato",
  "celonis",
  "ibm watson",
  "abbyy",
];

export const detectCompetitorMention: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    const lower = c.statement.toLowerCase();
    const matched = COMPETITORS.find((t) => lower.includes(t));
    if (!matched) continue;
    if (matched === "uipath") continue; // skip self
    out.push({
      kind: "competitive_mention",
      severity: "medium",
      title: `Competitive mention: ${matched}`,
      summary: c.statement,
      entityName: matched,
      entityKind: "competitor",
      claimIds: [c.id],
      attributes: { competitor: matched },
    });
  }
  return out;
};

export const COMPETITIVE_DETECTORS: SignalDetector[] = [detectCompetitorMention];
