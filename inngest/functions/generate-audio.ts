/**
 * Render a briefing to audio via Google Cloud TTS and persist the MP3 to Vercel Blob.
 *
 * The TTS chain handles voice fallback (Chirp3-HD → Studio-O → Journey-F → Neural2-C).
 * Briefings longer than ~5000 chars are summarized to a 90-second TTS prelude.
 */

import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { synthesize } from "@/lib/tts/google";
import { env } from "@/lib/env";
import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";

const MAX_TTS_CHARS = 4800;

export const generateAudio = inngest.createFunction(
  { id: "generate-audio", retries: 2, concurrency: { limit: 2 } },
  { event: "briefing/audio.requested" },
  async ({ event, step }) => {
    const { briefingId } = event.data;

    const briefing = await step.run("load-briefing", async () => {
      const rows = await db()
        .select()
        .from(schema.briefings)
        .where(eq(schema.briefings.id, briefingId))
        .limit(1);
      if (rows.length === 0) throw new Error(`briefing ${briefingId} not found`);
      return rows[0];
    });

    if (!briefing.contentMd) return { skipped: "no_content" };
    if (briefing.audioUrl) return { skipped: "already_rendered" };

    // If the briefing is long, shrink it to a TTS-friendly script
    let script = briefing.contentMd;
    if (script.length > MAX_TTS_CHARS) {
      const { text } = await step.run("shrink-script", async () =>
        callClaude({
          modelKey: "haiku45",
          system: systemPromptFor({
            mode: "brief",
            voice: "spoken",
            extra:
              "Rewrite as a 90-second spoken script. No bullet points. No markdown. Plain prose. Use contractions. Pace for breath.",
          }),
          prompt: `Compress to 90 seconds:\n\n${script}`,
          maxTokens: 1500,
          purpose: "audio-script",
        }),
      );
      script = text.trim();
    }

    const audio = await step.run("synthesize", async () => synthesize({ text: script }));

    const dateStr =
      typeof briefing.forDate === "string"
        ? briefing.forDate.slice(0, 10)
        : new Date(briefing.forDate).toISOString().slice(0, 10);
    const blobPath = `briefings/${dateStr}/${briefing.id}.mp3`;
    const uploaded = await step.run("upload", async () => {
      if (!env().BLOB_READ_WRITE_TOKEN) {
        // No Blob configured — store base64 inline. Caller renders via data URL.
        return { url: `data:audio/mp3;base64,${audio.audioContent}` };
      }
      const bytes = Buffer.from(audio.audioContent, "base64");
      const { url } = await put(blobPath, bytes, {
        access: "public",
        contentType: "audio/mp3",
        token: env().BLOB_READ_WRITE_TOKEN,
      });
      return { url };
    });

    await step.run("update-audio-url", async () => {
      await db()
        .update(schema.briefings)
        .set({ audioUrl: uploaded.url })
        .where(eq(schema.briefings.id, briefingId));
    });

    return { briefingId, audioUrl: uploaded.url, voice: audio.voice };
  },
);
