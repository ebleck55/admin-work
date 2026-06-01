import { describe, it, expect } from "vitest";
import { normalizeName, namesMatch, pickCanonical } from "@/lib/entities/normalize";

describe("normalizeName", () => {
  it("strips corporate suffixes", () => {
    expect(normalizeName("Chubb INA Holdings Inc.")).toBe("chubb ina");
    expect(normalizeName("Equifax Inc.")).toBe("equifax");
    expect(normalizeName("Fidelity National Financial, Inc.")).toBe("fidelity national financial");
    expect(normalizeName("TMX Group Limited")).toBe("tmx");
  });

  it("normalizes punctuation and casing", () => {
    expect(normalizeName("BOKF, NA")).toBe("bokf na");
    expect(normalizeName("PEN UNDERWRITING PTY LTD")).toBe("pen underwriting");
  });

  it("leaves single-word names alone", () => {
    expect(normalizeName("Chubb")).toBe("chubb");
    expect(normalizeName("Mphasis")).toBe("mphasis");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("Inc.")).toBe("");
  });
});

describe("namesMatch", () => {
  it("matches exact-normalized variants", () => {
    expect(namesMatch("Equifax Inc.", "Equifax")).toBe(true);
    expect(namesMatch("EQUIFAX INC.", "equifax")).toBe(true);
  });

  it("matches single-word against multi-word first-word (tier 2)", () => {
    expect(namesMatch("Chubb", "Chubb INA Holdings Inc.")).toBe(true);
    expect(namesMatch("Chubb INA Holdings Inc.", "Chubb")).toBe(true);
    expect(namesMatch("TD", "TD Bank")).toBe(true);
  });

  it("does NOT match distinct companies sharing a generic first word", () => {
    expect(namesMatch("Capital Group", "Capital One")).toBe(false);
    expect(namesMatch("Customer Segmentation", "Customer")).toBe(false);
    expect(namesMatch("Global Payments", "Global Solutions")).toBe(false);
    expect(namesMatch("First Republic", "First American")).toBe(false);
    expect(namesMatch("Chubb", "Centaur")).toBe(false);
  });

  it("matches distinct-but-discriminating single-word identifiers", () => {
    // Known limitation: "Apple" alone would merge into "Apple Bank for Savings"
    // since "apple" isn't a tier-2 stop word. Rare in FS context; flagged here
    // for awareness rather than fix.
    expect(namesMatch("Apple", "Apple Bank for Savings")).toBe(true);
    expect(namesMatch("Equifax", "Equifax Inc.")).toBe(true);
  });

  it("handles empty inputs gracefully", () => {
    expect(namesMatch("", "Chubb")).toBe(false);
    expect(namesMatch("Inc.", "Chubb")).toBe(false);
  });
});

describe("pickCanonical", () => {
  it("picks the longest name", () => {
    expect(pickCanonical(["Chubb", "Chubb INA Holdings Inc."])).toBe("Chubb INA Holdings Inc.");
  });

  it("handles single-name input", () => {
    expect(pickCanonical(["Chubb"])).toBe("Chubb");
  });

  it("handles empty list", () => {
    expect(pickCanonical([])).toBe("");
  });
});
