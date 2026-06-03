/**
 * Fact-verification pass.
 *
 * The grounding rules in the system prompt are necessary but not sufficient — LLMs still
 * fabricate numbers, amounts, dates, and quotes. This module activates the `verify_facts`
 * task (Haiku 4.5) that the router defined but nothing called: given a generated artifact and
 * the evidence it was built from, it flags every figure/quote/date NOT supported by the
 * evidence so the surface can badge it "unverified" before Eric forwards it.
 */

import { callClaude } from "@/lib/llm/anthropic";
import { modelKeyForTask } from "@/lib/llm/router";

export interface UnverifiedSpan {
  /** The exact text from the generated artifact that could not be verified. */
  span: string;
  /** Short reason, e.g. "no matching amount in evidence". */
  reason: string;
}

export interface VerifyResult {
  verified: boolean;
  unverified: UnverifiedSpan[];
  /** True when the verifier itself errored — caller should fail open but note it. */
  checkSkipped?: boolean;
}

const VERIFY_SYSTEM = `You are a strict fact-checker for an executive sales briefing tool. You are given GENERATED TEXT and the SOURCE EVIDENCE it was written from. Your only job is to find factual claims in the generated text that are NOT directly supported by the evidence.

Focus on high-stakes, checkable facts: dollar amounts, ARR/figures, percentages, dates/quarters, named people/accounts, and verbatim quotes. Ignore stylistic phrasing and general analysis.

Return ONLY a JSON object, no prose, in exactly this shape:
{"unverified":[{"span":"<exact text from the generated output>","reason":"<why it isn't supported>"}]}
If every checkable claim is supported by the evidence, return {"unverified":[]}.`;

/** Best-effort JSON extraction (handles models that wrap output in prose or fences). */
function parseUnverified(text: string): UnverifiedSpan[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { unverified?: unknown };
    if (!Array.isArray(parsed.unverified)) return [];
    return parsed.unverified
      .filter(
        (u): u is UnverifiedSpan =>
          !!u && typeof (u as UnverifiedSpan).span === "string",
      )
      .map((u) => ({ span: u.span, reason: typeof u.reason === "string" ? u.reason : "unsupported" }));
  } catch {
    return [];
  }
}

/**
 * Verify a generated artifact against its source evidence. Fails open (returns verified:true
 * with checkSkipped:true) if the verifier errors — we never want a checker outage to block a
 * briefing, but the skip is surfaced so it's visible.
 */
export async function verifyFacts(input: {
  generated: string;
  evidence: string;
}): Promise<VerifyResult> {
  if (!input.generated.trim() || !input.evidence.trim()) {
    return { verified: true, unverified: [] };
  }
  try {
    const result = await callClaude({
      modelKey: modelKeyForTask("verify_facts"),
      system: VERIFY_SYSTEM,
      prompt: `GENERATED TEXT:\n${input.generated}\n\nSOURCE EVIDENCE:\n${input.evidence}`,
      maxTokens: 1024,
      temperature: 0,
      purpose: "verify-facts",
    });
    const unverified = parseUnverified(result.text);
    return { verified: unverified.length === 0, unverified };
  } catch (err) {
    console.error("[verify] fact-check failed (failing open):", err);
    return { verified: true, unverified: [], checkSkipped: true };
  }
}

/** Render unverified spans as a markdown footer to append to a shareable artifact. */
export function unverifiedFooterMd(spans: UnverifiedSpan[]): string {
  if (spans.length === 0) return "";
  const lines = spans.map((s) => `- "${s.span}" — ${s.reason}`).join("\n");
  return `\n\n---\n⚠️ **Unverified claims** (not found in the cited evidence — confirm before sharing):\n${lines}`;
}
