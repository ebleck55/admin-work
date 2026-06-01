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

  it("falls back to Opportunity Name when no Opportunity ID column", () => {
    const csv = `Opportunity Name,Stage,Amount
No-ID Deal,Proposal,100000
Another Deal,Closed Won,50000`;
    const result = parseSalesforceCsv(csv, "2026-05-28");
    expect(result.rowsRead).toBe(2);
    expect(result.rowsSkipped).toBe(0);
    expect(result.envelopes).toHaveLength(2);
    expect(result.envelopes[0].source_id).toContain("No-ID Deal");
  });

  it("skips rows missing any identifying field (no id, no name, no account)", () => {
    const csv = `Stage,Amount
Proposal,100000`;
    const result = parseSalesforceCsv(csv, "2026-05-28");
    expect(result.rowsSkipped).toBe(1);
    expect(result.envelopes).toHaveLength(0);
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

  it("handles the UiPath FS GTM export shape (no Opportunity ID column, iARR fields)", () => {
    const csv = `Territory Region,Opportunity Owner,Account Name,Opportunity Name,Stage,Forecast Category,Total Amount Currency,Total Amount,Billed iARR Currency,Billed iARR,Billed iARR Best-Case Incremental Currency,Billed iARR Best-Case Incremental,ARR to Renew Currency,ARR to Renew,Billed Downsell iARR Currency,Billed Downsell iARR,Fiscal Period,Close Date,Opportunity Next Steps,Type
FS-East,Maya Chen,Aurora Bank,Aurora Bank — Process Mining,Proposal,Commit,USD,450000,USD,180000,USD,90000,USD,250000,USD,0,FY26-Q3,2026-09-30,Send SOC 2 letter to CISO,New Business`;
    const result = parseSalesforceCsv(csv, "2026-05-31");
    expect(result.rowsRead).toBe(1);
    expect(result.rowsSkipped).toBe(0);
    expect(result.envelopes).toHaveLength(1);

    const env = result.envelopes[0];
    // Source ID falls back to Account§OpportunityName
    expect(env.source_id).toBe("Aurora Bank§Aurora Bank — Process Mining@2026-05-31");
    expect(env.entities.find((e) => e.kind === "opportunity")?.name).toBe(
      "Aurora Bank — Process Mining",
    );
    expect(env.entities.find((e) => e.kind === "rep")?.name).toBe("Maya Chen");

    // FS-specific iARR claims emitted
    const billed = env.claims.find((c) => c.attributes?.field === "billed_iarr");
    expect(billed?.attributes?.amount).toBe(180000);
    const renew = env.claims.find((c) => c.attributes?.field === "arr_to_renew");
    expect(renew?.attributes?.amount).toBe(250000);
    expect(renew?.module_id).toBe("cs");

    // Downsell of 0 doesn't emit a claim
    const downsell = env.claims.find((c) => c.attributes?.field === "billed_downsell_iarr");
    expect(downsell).toBeUndefined();

    // Next step from "Opportunity Next Steps" header alias
    const next = env.claims.find((c) => c.attributes?.field === "next_step");
    expect(next?.attributes?.next_step).toBe("Send SOC 2 letter to CISO");
  });
});
