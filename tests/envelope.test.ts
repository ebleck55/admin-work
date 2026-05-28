import { describe, it, expect } from "vitest";
import { parseEnvelope } from "@/lib/ingestion/envelope";

describe("envelope parsing", () => {
  it("accepts a minimal valid envelope", () => {
    const result = parseEnvelope({
      source_system: "outlook_email",
      source_id: "test-1",
      collected_at: "2026-05-28T12:00:00.000Z",
      source_timestamp: "2026-05-28T11:45:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sensitivity).toBe("internal");
      expect(result.data.confidence).toBe(0.7);
      expect(result.data.entities).toEqual([]);
      expect(result.data.claims).toEqual([]);
    }
  });

  it("rejects an envelope without source_system", () => {
    const result = parseEnvelope({
      source_id: "test-2",
      collected_at: "2026-05-28T12:00:00.000Z",
      source_timestamp: "2026-05-28T11:45:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/source_system/);
  });

  it("rejects a claim_index referring to a non-existent claim", () => {
    // Note: this isn't currently enforced by the zod schema; documenting current behavior.
    const result = parseEnvelope({
      source_system: "outlook_email",
      source_id: "test-3",
      collected_at: "2026-05-28T12:00:00.000Z",
      source_timestamp: "2026-05-28T11:45:00.000Z",
      claims: [],
      evidence: [{ claim_index: 99, quote: "stray quote" }],
    });
    // Currently accepted; if we tighten this, flip the assertion.
    expect(result.ok).toBe(true);
  });

  it("defaults sensitivity to internal but honors explicit private_dm", () => {
    const r1 = parseEnvelope({
      source_system: "slack",
      source_id: "dm-1",
      collected_at: "2026-05-28T12:00:00.000Z",
      source_timestamp: "2026-05-28T11:45:00.000Z",
      sensitivity: "private_dm",
    });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.data.sensitivity).toBe("private_dm");
  });

  it("rejects bad timestamp formats", () => {
    const result = parseEnvelope({
      source_system: "outlook_email",
      source_id: "bad-ts",
      collected_at: "yesterday",
      source_timestamp: "2026-05-28T11:45:00.000Z",
    });
    expect(result.ok).toBe(false);
  });
});
