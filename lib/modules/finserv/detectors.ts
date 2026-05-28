import type { SignalCandidate, SignalDetector } from "@/lib/modules/types";

const REGULATORY_TERMS = [
  // Compliance frameworks
  "fedramp",
  "soc 2",
  "soc2",
  "iso 27001",
  "iso27001",
  "nist 800",
  "nist 800-53",
  "pci dss",
  // FS-specific regs
  "kyc",
  "aml",
  "bsa",
  "ofac",
  "dodd-frank",
  "nydfs",
  "ffiec",
  "occ",
  "fdic",
  "finra",
  "sec rule",
  "glba",
  "ccpa",
  "gdpr",
  // Audit / governance
  "third-party risk",
  "vendor risk",
  "internal audit",
  "data residency",
];

export const detectRegulatoryMention: SignalDetector = async (ctx) => {
  const out: SignalCandidate[] = [];
  for (const c of ctx.claims) {
    const lower = c.statement.toLowerCase();
    const matched = REGULATORY_TERMS.find((t) => lower.includes(t));
    if (!matched) continue;
    out.push({
      kind: "regulatory_signal",
      severity: "medium",
      title: `Regulatory mention: ${matched.toUpperCase()}`,
      summary: c.statement,
      entityName: c.entity_ref?.name,
      entityKind: c.entity_ref?.kind,
      claimIds: [c.id],
      attributes: { matched_term: matched },
    });
  }
  return out;
};

export const FINSERV_DETECTORS: SignalDetector[] = [detectRegulatoryMention];
