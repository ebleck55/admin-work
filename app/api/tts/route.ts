import { NextResponse, type NextRequest } from "next/server";

import { ClientError, withHandler } from "@/lib/api/handler";
import { speak } from "@/lib/tts/client";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Server-side TTS proxy. Browser POSTs `{ text, voice?, speakingRate? }`,
 * we return `{ audioContent: base64MP3, voice, source }`. The client decides
 * whether to play short utterances via SpeechSynthesis (free, no roundtrip)
 * or call this endpoint for longer content.
 */
export const POST = withHandler(async (req: NextRequest) => {
  const body = (await req.json()) as {
    text?: string;
    voice?: string;
    speakingRate?: number;
    pitch?: number;
  };
  if (!body.text || typeof body.text !== "string") {
    throw new ClientError("text required", 400);
  }
  if (body.text.length > 5000) {
    throw new ClientError("text too long (max 5000 chars)", 400);
  }
  const result = await speak({
    text: body.text,
    voices: body.voice ? [body.voice as "chirp3-hd-aoede"] : undefined,
    speakingRate: body.speakingRate,
    pitch: body.pitch,
  });
  return result;
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
