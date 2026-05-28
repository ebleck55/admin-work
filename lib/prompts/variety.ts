/**
 * Anti-repetition seed for prompts.
 *
 * Ported from `bart-app/learning-quest/lib/prompts.ts varietySeed()` and the same in
 * `learning-quest-grade5/lib/prompts.ts`. Critical for COS — without variety nudging,
 * 30+ briefings/month generated from similar inputs collapse into a same-y voice.
 */

const ANGLES = [
  "lead with the most actionable insight",
  "open with the most surprising signal",
  "structure as risks first, opportunities second",
  "structure as opportunities first, risks second",
  "anchor on a specific customer or rep, then expand",
  "anchor on a theme or pattern, then ground in examples",
  "lead with what changed since yesterday's briefing",
  "lead with the highest-confidence signals",
];

const TONES = [
  "matter-of-fact",
  "diagnostic",
  "forward-looking",
  "investigative",
  "consultative",
];

const DETAIL_FLAVORS = [
  "include one concrete example per claim",
  "include two contrasting examples per claim",
  "prefer numbers and named entities over abstractions",
  "lead each section with the bottom line, then evidence",
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/**
 * Returns a short stanza to splice into a prompt. Reseeded per call so the same builder
 * doesn't produce identical output across a multi-briefing run.
 */
export function varietySeed(): string {
  const t = Date.now();
  const r = Math.floor(Math.random() * 1_000_000);
  const seed = t ^ r;
  return [
    `Variety seed: ${seed}.`,
    `Angle: ${pick(ANGLES, seed)}.`,
    `Tone: ${pick(TONES, seed >> 3)}.`,
    `Detail: ${pick(DETAIL_FLAVORS, seed >> 7)}.`,
    "Vary phrasing across sections.",
  ].join(" ");
}
