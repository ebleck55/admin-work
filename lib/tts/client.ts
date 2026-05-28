/**
 * TTS client. Decides cache-hit vs cloud, and offers a prefetch helper analogous
 * to learning-quest-grade5's `prefetchCloudTTS()` so the morning briefing
 * cron can warm the cache before Eric opens the dashboard.
 */

import { synthesize, type SynthesizeOptions } from "@/lib/tts/google";
import { cacheKey, get, put } from "@/lib/tts/cache";

export interface SpeakResult {
  audioContent: string;
  voice: string;
  source: "cache" | "google";
}

export async function speak(opts: SynthesizeOptions): Promise<SpeakResult> {
  const voice = opts.voices?.[0] ?? "chirp3-hd-aoede";
  const key = cacheKey(opts.text, voice);
  const cached = get(key);
  if (cached) return { audioContent: cached.audioContent, voice: cached.voice, source: "cache" };
  const result = await synthesize(opts);
  put(key, { audioContent: result.audioContent, voice: result.voice });
  return { audioContent: result.audioContent, voice: result.voice, source: "google" };
}

/** Fire-and-forget prefetch — used by the morning briefing cron. */
export function prefetch(text: string, voices?: SynthesizeOptions["voices"]): void {
  void speak({ text, voices }).catch(() => {
    /* prefetch failures are non-fatal */
  });
}
