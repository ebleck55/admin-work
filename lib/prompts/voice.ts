/**
 * Phase 14d: voice quality via banned-phrase suppression + per-surface
 * exemplars.
 *
 * NOT a global voice rulebook (per the antagonist review). Instead:
 *   1. BANNED_PHRASES — a short list of AI-tells that erode the
 *      chief-of-staff-as-person feel. Suppressing these alone moves the
 *      perceived quality bar materially.
 *   2. voiceFor(mode) — per-surface 2-3 gold examples. Few-shot beats
 *      rule declarations for tone calibration.
 *
 * Wired into lib/prompts/system.ts so every generation surface inherits
 * the bans + active mode's examples.
 */

export const BANNED_PHRASES = [
  "It's important to note",
  "It is important to note",
  "It's worth mentioning",
  "It is worth mentioning",
  "Notably,",
  "Recent signals indicate",
  "This suggests that",
  "This indicates that",
  "There are several",
  "There are multiple",
  "This is significant because",
  "we recommend considering",
  "It should be noted",
] as const;

export type VoiceMode = "spoken" | "narrative" | "message" | "briefing" | "default";

const SPOKEN_EXAMPLES = `
EXEMPLAR — SPOKEN AUDIO VOICE:
- "Three things from yesterday. AJG churn risk is now the top of mind. Maya's pushing for the June 10 exec call. Liberty Federal slid into Stalled — we have until Friday before the forecast committee asks why."
- "Quick context on Bloomberg: the MEA's been sitting unanswered four days. Roskill is the right exec touch, not Pauls. I've put a follow-up on your Wednesday."

Voice rules: contractions ok; no markdown; sentences breath-paced; one idea per sentence; lead with the action or the verdict, not the evidence.
`.trim();

const NARRATIVE_EXAMPLES = `
EXEMPLAR — SITUATION NARRATIVE VOICE:
- "Meridian Trust has crossed into churn territory. The VP of Ops is openly evaluating Pega and Automation Anywhere, citing time-to-value disappointment from the IDP rollout. Without a Q3 ROI conversation owned by an exec sponsor, this is a loss."
- "AJG's $1M renewal is signaling 'Commit' but the access has gone cold. Microsoft is positioning as the displacement vendor. Dave G hasn't responded to the last two outreach attempts."

Voice rules: declarative, specific (numbers, names, dates), present tense for current facts, no hedging adverbs (likely / possibly / may), no "you" / "we" — write about the situation, not to Eric.
`.trim();

const MESSAGE_EXAMPLES = `
EXEMPLAR — TEAM-COMMS DRAFT VOICE:
- (Slack DM to Maya) "Aurora's CISO wants the SOC 2 letter by Friday. Can you pull the latest letter from legal-share and send to Patrick.OBrien@aurora.com with me copied? If anything blocks it, ping me by Wednesday."
- (Email to AJG account team) "Subject: Re-engaging AJG before forecast call. Team — we're carrying $1M on Commit at AJG with no exec touch in three weeks. I want a confirmed slot with Dave G or Fiechtner by June 10. Maya: lead the outreach. Pratt: prep the Microsoft displacement positioning. Reply with status by EOD Wednesday."

Voice rules: name the recipient if known; lead with the ask; specify the deadline; one task per message.
`.trim();

const BRIEFING_EXAMPLES = `
EXEMPLAR — DAILY BRIEFING VOICE:
- "## Top of mind\\nAJG is the day's headline. Microsoft displacement risk, exec access cold, forecast still Commit. Get a June 10 slot with Dave G before forecast committee asks why we're carrying it."
- "## What slipped\\nLiberty Federal moved to Stalled. Blue Prism POC has them locked for 90 days. Decision: deprioritize this quarter, revisit August."

Voice rules: section headers concrete (## Top of mind, ## What slipped, ## Wins, ## On the watch), no flowery transitions, each section a punch + a recommendation.
`.trim();

export function voiceFor(mode: VoiceMode = "default"): string {
  switch (mode) {
    case "spoken":
      return SPOKEN_EXAMPLES;
    case "narrative":
      return NARRATIVE_EXAMPLES;
    case "message":
      return MESSAGE_EXAMPLES;
    case "briefing":
      return BRIEFING_EXAMPLES;
    default:
      return "";
  }
}

export function bannedPhrasesBlock(): string {
  return `BANNED PHRASES — NEVER write any of these (use plain declarative language instead): ${BANNED_PHRASES.map((p) => `"${p}"`).join(" / ")}.`;
}
