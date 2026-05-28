import { describe, it, expect } from "vitest";
import { parseSalesforceCsv } from "@/lib/ingestion/source-adapters/salesforce-csv";

describe("salesforce CSV adapter", () => {
  it("parses a minimal valid row into a single envelope with the expected claims", () => {
    const csv = `Opportunity ID,Opportunity Name,Account Name,Stage,Amount,Close Date,Probability,Owner,Next Step
OPP-001,Sample Bank — Q3 Expansion,Sample Bank,Proposal,250000,2026-09-30,75%,Eric Bouchard,Send SOC 2 letter`;

    const result = parseSalesforceCsv(csv, "2026-05-28");
    expect(result.rowsRead).toBe(1);
    expect(result.rowsSkipped).toBe(0);
    expect(result.envelopes).toHaveLength(1);

    const env = result.envelopes[0];
    expect(env.source_system).toBe("salesforce");
    expect(env.source_id).toBe("OPP-001@2026-05-28");
    expect(env.entities.find((e) => e.kind === "opportunity")?.name).toBe(
      "Sample Bank — Q3 Expansion",
    );
    expect(env.entities.find((e) => e.kind === "account")?.name).toBe("Sample Bank");
    expect(env.entities.find((e) => e.kind === "rep")?.name).toBe("Eric Bouchard");

    const stageClaim = env.claims.find((c) => c.attributes?.field === "stage");
    expect(stageClaim).toBeDefined();
    expect(stageClaim?.attributes?.stage).toBe("Proposal");

    const amountClaim = env.claims.find((c) => c.attributes?.field === "amount");
    expect(amountClaim?.attributes?.amount).toBe(250000);

    expect(env.confidence).toBe(0.75);
  });

  it("skips rows without opportunity_id", () => {
    const csv = `Opportunity ID,Opportunity Name,Stage,Amount
,No-ID Deal,Proposal,100000
OPP-002,Real Deal,Closed Won,50000`;
    const result = parseSalesforceCsv(csv, "2026-05-28");
    expect(result.rowsRead).toBe(2);
    expect(result.rowsSkipped).toBe(1);
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].source_id).toContain("OPP-002");
  });

  it("maps Internal Only=Yes to private_dm sensitivity", () => {
    const csv = `Opportunity ID,Opportunity Name,Stage,Internal Only
OPP-003,Quiet Deal,Discovery,Yes`;
    const result = parseSalesforceCsv(csv, "2026-05-28");
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].sensitivity).toBe("private_dm");
  });

  it("strips currency formatting from amounts", () => {
    const csv = `Opportunity ID,Opportunity Name,Amount
OPP-004,Currency Deal,"$1,234,567"`;
    const result = parseSalesforceCsv(csv, "2026-05-28");
    expect(result.envelopes[0].claims[0].attributes?.amount).toBe(1234567);
  });
});
