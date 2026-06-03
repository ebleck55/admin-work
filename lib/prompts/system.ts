/**
 * System-prompt builder.
 *
 * Mirrors `bart-app/server/lib/orchestrator.js:91-106, 965-990` (BART_IDENTITY +
 * BART_CAPABILITIES + mode guidance). Identity rewritten for the COS persona.
 */

import { GROUNDING_CLAUSES, SENSITIVITY_CLAUSES } from "@/lib/llm/safety";
import { INJECTION_DEFENSE_CLAUSES } from "@/lib/prompts/evidence-block";
import { bannedPhrasesBlock, voiceFor, type VoiceMode } from "@/lib/prompts/voice";

const COS_IDENTITY = `You are Chief of Staff, an analyst-assistant for Eric Bouchard, SVP of Financial Services GTM at UiPath. Your job is to surface deal risks, expansion plays, coaching moments, regulatory signals, competitive themes, and exec-comms drafts — every claim grounded in the evidence ledger.`;

const COS_CAPABILITIES = `
CAPABILITIES:
- You operate over an evidence ledger built from Outlook email, Outlook calendar, UiPath Slack, UiPath Zoom transcripts, and manual Salesforce exports — all extracted upstream by OpenAI Codex and dropped into the app via the canonical payload envelope.
- Eight modules: Pipeline, Customer Success, Team Performance, Strategic Initiatives, FinServ Vertical Intel, Competitive Intel, Priority Feed, Exec Communications.
- Every claim, signal, briefing, and answer must cite the evidence (format [evidence #id]) it came from.
- Sensitivity matters: private Slack DMs surface to Eric's personal feed only — never to shareable artifacts.
`.trim();

export type SystemPromptMode =
  | "classify"
  | "extract"
  | "answer"
  | "brief"
  | "alert"
  | "verify";

const MODE_GUIDANCE: Record<SystemPromptMode, string> = {
  classify:
    "Return a single classification JSON object — no prose. Be conservative; prefer 'unknown' to guessing.",
  extract:
    "Pull structured claims from the supplied evidence. Output JSON conforming to the requested schema. Quote spans verbatim in the evidence array.",
  answer:
    "Answer Eric's question grounded in retrieved evidence. Cite each non-trivial claim. If retrieval missed the answer, say so.",
  brief:
    "Generate a clear, scannable briefing. Lead with the bottom line per section. Cite evidence inline. Vary phrasing across sections.",
  alert:
    "Generate a one-sentence alert headline and a two-sentence body. Keep it operational. Cite the triggering signal.",
  verify:
    "Check the supplied claims against the supplied evidence. Flag any claim not supported by the evidence as unverified, with reasoning.",
};

export interface SystemPromptOptions {
  mode: SystemPromptMode;
  /** Extra rules/instructions specific to the task (appended). */
  extra?: string;
  /**
   * Optional voice-mode hint for Phase 14d per-surface exemplars. When omitted
   * the system prompt skips the voice exemplar block but still injects the
   * banned-phrase suppression list.
   */
  voice?: VoiceMode;
}

/** Modes whose prompts include third-party evidence and therefore need injection defense. */
const EVIDENCE_CONSUMING_MODES: ReadonlySet<SystemPromptMode> = new Set([
  "answer",
  "brief",
  "extract",
  "verify",
]);

export function systemPromptFor(opts: SystemPromptOptions): string {
  const voiceBlock = opts.voice ? voiceFor(opts.voice) : "";
  const injectionBlock = EVIDENCE_CONSUMING_MODES.has(opts.mode)
    ? INJECTION_DEFENSE_CLAUSES
    : "";
  return [
    COS_IDENTITY,
    COS_CAPABILITIES,
    `CURRENT MODE: ${opts.mode}. ${MODE_GUIDANCE[opts.mode]}`,
    bannedPhrasesBlock(),
    voiceBlock,
    GROUNDING_CLAUSES,
    SENSITIVITY_CLAUSES,
    injectionBlock,
    opts.extra ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
