/**
 * Record user feedback on a signal or situation. Feeds into Phase 10's
 * grader-tuning loop (and into future "Eric never wants this kind of
 * signal" preference learning).
 */

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const VALID_VALENCES = new Set(["up", "down", "not_relevant"]);
const VALID_TARGETS = new Set(["signal", "situation"]);

export const POST = withHandler(async (req) => {
  const body = (await req.json()) as {
    targetKind?: string;
    targetId?: string;
    valence?: string;
    reasonCategory?: string;
    reasonText?: string;
  };
  if (!body.targetKind || !VALID_TARGETS.has(body.targetKind)) {
    throw new ClientError(`targetKind must be one of: ${Array.from(VALID_TARGETS).join(", ")}`, 400);
  }
  if (!body.targetId) throw new ClientError("targetId required", 400);
  if (!body.valence || !VALID_VALENCES.has(body.valence)) {
    throw new ClientError(`valence must be one of: ${Array.from(VALID_VALENCES).join(", ")}`, 400);
  }

  const inserted = await db()
    .insert(schema.feedback)
    .values({
      targetKind: body.targetKind,
      targetId: body.targetId,
      valence: body.valence as "up" | "down" | "not_relevant",
      reasonCategory: body.reasonCategory ?? null,
      reasonText: body.reasonText ?? null,
    })
    .returning({ id: schema.feedback.id });

  return { id: inserted[0].id };
});
