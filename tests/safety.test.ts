import { describe, it, expect } from "vitest";
import { redactPii, checkOutputEligibility } from "@/lib/llm/safety";

describe("PII redaction", () => {
  it("redacts US SSN format", () => {
    const r = redactPii("My SSN is 123-45-6789 — please confirm.");
    expect(r.text).toContain("[REDACTED:SSN]");
    expect(r.text).not.toContain("123-45-6789");
    expect(r.redactions.find((x) => x.rule === "us_ssn")?.count).toBe(1);
  });

  it("redacts credit-card-shaped numbers", () => {
    const r = redactPii("Card 4111 1111 1111 1111 exp 12/29.");
    expect(r.text).toContain("[REDACTED:CARD]");
    expect(r.redactions.find((x) => x.rule === "credit_card")?.count).toBeGreaterThan(0);
  });

  it("leaves normal corporate emails untouched", () => {
    const r = redactPii("Send to alice@example.com and bob@uipath.com.");
    expect(r.text).toContain("alice@example.com");
    expect(r.text).toContain("bob@uipath.com");
  });

  it("returns counts per rule", () => {
    const r = redactPii("SSNs: 111-22-3333 and 444-55-6666.");
    expect(r.redactions.find((x) => x.rule === "us_ssn")?.count).toBe(2);
  });
});

describe("output eligibility (private_dm gating)", () => {
  it("allows shareable output when no private_dm contributions", () => {
    const c = checkOutputEligibility({
      shareable: true,
      contributingSensitivities: ["internal", "public"],
    });
    expect(c.allowed).toBe(true);
  });

  it("rejects shareable output that includes private_dm content", () => {
    const c = checkOutputEligibility({
      shareable: true,
      contributingSensitivities: ["internal", "private_dm"],
    });
    expect(c.allowed).toBe(false);
    expect(c.reason).toMatch(/private_dm/);
  });

  it("allows non-shareable outputs to use any sensitivity", () => {
    const c = checkOutputEligibility({
      shareable: false,
      contributingSensitivities: ["internal", "private_dm"],
    });
    expect(c.allowed).toBe(true);
  });
});
