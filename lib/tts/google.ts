/**
 * Google Cloud TTS REST client.
 *
 * Ported from learning-quest-grade5/lib/tts.ts (the K-5 version) and adapted:
 *   - Voice chain: Chirp3-HD-Aoede → Studio-O → Journey-F → Neural2-C
 *     (audit row L14). On 429/5xx, fall through to the next voice.
 *   - Long-form audio is base64 in the response but the caller persists to Vercel
 *     Blob; we don't decode here.
 *   - Uses fetch + API key auth (no OAuth) — keeps this edge-runtime-safe.
 */

import { env } from "@/lib/env";

export type GoogleTtsVoice = "chirp3-hd-aoede" | "studio-o" | "journey-f" | "neural2-c";

const VOICE_SPECS: Record<GoogleTtsVoice, { name: string; languageCode: string }> = {
  "chirp3-hd-aoede": { name: "en-US-Chirp3-HD-Aoede", languageCode: "en-US" },
  "studio-o":        { name: "en-US-Studio-O",        languageCode: "en-US" },
  "journey-f":       { name: "en-US-Journey-F",       languageCode: "en-US" },
  "neural2-c":       { name: "en-US-Neural2-C",       languageCode: "en-US" },
};

const VOICE_CHAIN: GoogleTtsVoice[] = ["chirp3-hd-aoede", "studio-o", "journey-f", "neural2-c"];

export interface SynthesizeOptions {
  text: string;
  /** Override the default voice chain. */
  voices?: GoogleTtsVoice[];
  speakingRate?: number; // 0.25..4.0
  pitch?: number;        // -20..20
}

export interface SynthesizeResult {
  audioContent: string;     // base64 MP3
  voice: GoogleTtsVoice;
  attempts: Array<{ voice: GoogleTtsVoice; ok: boolean; status?: number }>;
}

export async function synthesize(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const apiKey = env().GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY not configured");

  const voices = opts.voices ?? VOICE_CHAIN;
  const attempts: SynthesizeResult["attempts"] = [];

  for (const voice of voices) {
    const spec = VOICE_SPECS[voice];
    const body = {
      input: { text: opts.text },
      voice: { name: spec.name, languageCode: spec.languageCode },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: opts.speakingRate ?? 1.0,
        pitch: opts.pitch ?? 0.0,
      },
    };
    try {
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        attempts.push({ voice, ok: false, status: res.status });
        // Only retry on rate limit or server errors; bail on auth/quota errors
        if (res.status >= 500 || res.status === 429) continue;
        const errText = await res.text();
        throw new Error(`Google TTS ${res.status}: ${errText.slice(0, 300)}`);
      }
      const json = (await res.json()) as { audioContent: string };
      attempts.push({ voice, ok: true, status: res.status });
      return { audioContent: json.audioContent, voice, attempts };
    } catch (err) {
      attempts.push({ voice, ok: false });
      if (voice === voices[voices.length - 1]) {
        throw err;
      }
      // else fall through to next voice
    }
  }

  throw new Error(`All TTS voices failed: ${JSON.stringify(attempts)}`);
}

export const VOICE_CHAIN_DEFAULT = VOICE_CHAIN;
