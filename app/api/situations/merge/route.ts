/**
 * Phase 15b: merge two or more situations into one.
 *
 * POST { canonicalId, mergeIds[] }
 * - Picks canonicalId as the surviving row
 * - Unions signalIds across all merged + canonical
 * - Appends "(Merged from: <title1>, <title2>)" to canonical.reasoningMd
 * - Reassigns situation_actions from mergeIds to canonical
 * - Deletes mergeIds (action rows cascade)
 */

import { eq, inArray } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export const POST = withHandler(async (req) => {
  const body = (await req.json()) as { canonicalId?: string; mergeIds?: string[] };
  if (!body.canonicalId) throw new ClientError("canonicalId required", 400);
  if (!Array.isArray(body.mergeIds) || body.mergeIds.length === 0) {
    throw new ClientError("mergeIds (non-empty array) required", 400);
  }
  if (body.mergeIds.includes(body.canonicalId)) {
    throw new ClientError("mergeIds must not include canonicalId", 400);
  }

  const rows = await db()
    .select()
    .from(schema.situations)
    .where(inArray(schema.situations.id, [body.canonicalId, ...body.mergeIds]));
  const canonical = rows.find((r) => r.id === body.canonicalId);
  if (!canonical) throw new ClientError("canonical situation not found", 404);
  const merging = rows.filter((r) => r.id !== body.canonicalId);
  if (merging.length === 0) throw new ClientError("no valid mergeIds found", 404);

  // Union signal IDs, preserving order
  const allSignalIds = new Set<string>(canonical.signalIds);
  for (const m of merging) for (const s of m.signalIds) allSignalIds.add(s);

  // Append merge note to reasoning
  const mergedTitles = merging.map((m) => `"${m.title}"`).join(", ");
  const updatedReasoning = `${canonical.reasoningMd}\n\n(Merged: ${mergedTitles})`;

  await db()
    .update(schema.situations)
    .set({
      signalIds: Array.from(allSignalIds),
      reasoningMd: updatedReasoning,
      updatedAt: new Date(),
    })
    .where(eq(schema.situations.id, body.canonicalId));

  // Reassign actions from merging situations onto canonical (they cascade-delete
  // otherwise via FK ON DELETE CASCADE).
  await db()
    .update(schema.situationActions)
    .set({ situationId: body.canonicalId })
    .where(inArray(schema.situationActions.situationId, body.mergeIds));

  // Now safe to delete merging situations
  await db()
    .delete(schema.situations)
    .where(inArray(schema.situations.id, body.mergeIds));

  return {
    canonicalId: body.canonicalId,
    mergedCount: merging.length,
    signalCount: allSignalIds.size,
  };
});
