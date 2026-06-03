/**
 * Record user feedback on a signal or situation, AND — for situation
 * rejections — fan out into a durable memory_fact so future synthesis
 * runs naturally suppress similar candidates via embedding similarity.
 *
 * Phase 10 added the table; Phase 14a closes the loop end-to-end.
 */

import { eq } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";
import { addMemoryFact } from "@/lib/chat/memory";
import { inngest } from "@/inngest/client";

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

  const feedbackId = inserted[0].id;

  // Phase 14a: rejection on a situation becomes a durable memory_fact so the
  // synthesizer can suppress similar candidates via embedding similarity.
  let memoryFactId: string | undefined;
  if (
    body.targetKind === "situation" &&
    (body.valence === "down" || body.valence === "not_relevant") &&
    body.reasonCategory
  ) {
    try {
      const sitRows = await db()
        .select({
          title: schema.situations.title,
          severity: schema.situations.severity,
          sensitivity: schema.situations.sensitivity,
        })
        .from(schema.situations)
        .where(eq(schema.situations.id, body.targetId))
        .limit(1);
      const sit = sitRows[0];
      if (sit) {
        const reasonClause = body.reasonText
          ? `${body.reasonCategory} — ${body.reasonText.slice(0, 200)}`
          : body.reasonCategory;
        const factText = `Eric rejected the situation "${sit.title}" because ${reasonClause}. Don't surface situations like this again.`;
        const fact = await addMemoryFact({
          kind: "preference",
          text: factText,
          sensitivity: sit.sensitivity,
          weight: 1.5, // explicit rejection weighs higher than implicit context
        });
        memoryFactId = fact.id;
      }
    } catch (err) {
      console.error("[feedback] memory_fact fanout failed:", err instanceof Error ? err.message : err);
    }
  }

  // Phase 15a: fire an inference event so a downstream Inngest function can
  // distill a more general preference from the feedback corpus over time.
  void inngest
    .send({ name: "feedback/inserted", data: { feedbackId } })
    .catch((err) =>
      console.error(
        "[feedback] inngest fanout failed:",
        err instanceof Error ? err.message : err,
      ),
    );

  return { id: feedbackId, memoryFactId };
});
