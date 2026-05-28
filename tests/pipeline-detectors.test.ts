import { describe, it, expect } from "vitest";
import {
  detectCommitments,
  detectStageRisk,
  detectExpansion,
} from "@/lib/modules/pipeline/detectors";
import type { Claim } from "@/lib/ingestion/envelope";

function makeClaim(
  statement: string,
  attrs: Record<string, unknown> = {},
  id = `c-${Math.random().toString(36).slice(2)}`,
): Claim & { id: string } {
  return {
    id,
    statement,
    confidence: 0.8,
    attributes: attrs,
    entity_ref: { kind: "opportunity", name: "Sample Bank — Q3 Expansion" },
  };
}

const baseCtx = {
  envelope: {} as never,
};

describe("pipeline detectors", () => {
  it("detectCommitments flags claims with commitment language", async () => {
    const sigs = await detectCommitments({
      ...baseCtx,
      claims: [
        makeClaim("Eric committed to deliver the SOC 2 letter by Friday."),
        makeClaim("Stage moved from Discovery to Proposal."),
      ],
    });
    expect(sigs.length).toBe(1);
    expect(sigs[0].kind).toBe("commitment");
  });

  it("detectStageRisk flags Stalled/Lost stages", async () => {
    const sigs = await detectStageRisk({
      ...baseCtx,
      claims: [
        makeClaim("Stage now Closed Lost.", { stage: "Closed Lost" }),
        makeClaim("Stage now Proposal.", { stage: "Proposal" }),
        makeClaim("Stage now Stalled.", { stage: "Stalled" }),
      ],
    });
    expect(sigs.length).toBe(2);
    expect(sigs.some((s) => s.severity === "high")).toBe(true); // lost
  });

  it("detectExpansion flags expansion language", async () => {
    const sigs = await detectExpansion({
      ...baseCtx,
      claims: [
        makeClaim("Customer asked about additional licenses for the EMEA team."),
        makeClaim("They're happy with the current scope."),
      ],
    });
    expect(sigs.length).toBe(1);
    expect(sigs[0].kind).toBe("expansion_opp");
  });
});
