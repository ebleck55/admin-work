import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM wrapper so the verifier is tested without network/DB.
vi.mock("@/lib/llm/anthropic", () => ({ callClaude: vi.fn() }));

import { callClaude } from "@/lib/llm/anthropic";
import { verifyFacts, unverifiedFooterMd } from "@/lib/llm/verify";

const mockCall = vi.mocked(callClaude);

function reply(text: string) {
  mockCall.mockResolvedValueOnce({ text } as Awaited<ReturnType<typeof callClaude>>);
}

describe("verifyFacts", () => {
  beforeEach(() => mockCall.mockReset());

  it("returns verified:true when the model finds no unsupported claims", async () => {
    reply('{"unverified":[]}');
    const r = await verifyFacts({ generated: "ARR is $200k [evidence #1]", evidence: "ARR: $200k" });
    expect(r.verified).toBe(true);
    expect(r.unverified).toHaveLength(0);
  });

  it("flags fabricated figures and parses JSON wrapped in prose", async () => {
    reply('Sure: {"unverified":[{"span":"$5M","reason":"no matching amount in evidence"}]}');
    const r = await verifyFacts({ generated: "Deal closed at $5M", evidence: "Deal is in pipeline." });
    expect(r.verified).toBe(false);
    expect(r.unverified[0].span).toBe("$5M");
  });

  it("fails open (verified:true, checkSkipped) when the verifier errors", async () => {
    mockCall.mockRejectedValueOnce(new Error("boom"));
    const r = await verifyFacts({ generated: "x", evidence: "y" });
    expect(r.verified).toBe(true);
    expect(r.checkSkipped).toBe(true);
  });

  it("skips the call entirely for empty input", async () => {
    const r = await verifyFacts({ generated: "  ", evidence: "y" });
    expect(r.verified).toBe(true);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe("unverifiedFooterMd", () => {
  it("is empty when nothing is unverified", () => {
    expect(unverifiedFooterMd([])).toBe("");
  });

  it("renders a warning footer with each span", () => {
    const md = unverifiedFooterMd([{ span: "$5M", reason: "unsupported" }]);
    expect(md).toContain("Unverified claims");
    expect(md).toContain('"$5M" — unsupported');
  });
});
