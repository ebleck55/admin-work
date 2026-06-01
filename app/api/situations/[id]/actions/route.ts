/**
 * Phase 7 action verbs on situations:
 *   acknowledge — mark seen, no status change
 *   snooze      — hide until snoozed_until (default +24h, optional hours payload)
 *   escalate    — bump status to 'escalated'
 *   resolve     — mark resolved
 *
 * Every action is logged in situation_actions for audit + future feedback loop.
 */

import { eq } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["acknowledge", "snooze", "escalate", "resolve"]);

export const POST = withHandler(async (req) => {
  const url = new URL(req.url);
  const id = url.pathname.split("/").slice(-3, -2)[0];
  if (!id || id.length < 8) throw new ClientError("Invalid situation id", 400);

  const body = (await req.json()) as { kind?: string; payload?: Record<string, unknown> };
  if (!body.kind || !VALID_KINDS.has(body.kind)) {
    throw new ClientError(`Invalid action kind. Expected one of: ${Array.from(VALID_KINDS).join(", ")}`, 400);
  }

  const sitRows = await db()
    .select()
    .from(schema.situations)
    .where(eq(schema.situations.id, id))
    .limit(1);
  if (sitRows.length === 0) throw new ClientError("Situation not found", 404);

  const payload = body.payload ?? {};

  switch (body.kind) {
    case "acknowledge":
      // Log only; status unchanged. Used as a "seen" signal for future ranking.
      break;
    case "snooze": {
      const hours = typeof payload.hours === "number" && payload.hours > 0 ? payload.hours : 24;
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      await db()
        .update(schema.situations)
        .set({ status: "snoozed", snoozedUntil: until, updatedAt: new Date() })
        .where(eq(schema.situations.id, id));
      break;
    }
    case "escalate":
      await db()
        .update(schema.situations)
        .set({ status: "escalated", updatedAt: new Date() })
        .where(eq(schema.situations.id, id));
      break;
    case "resolve":
      await db()
        .update(schema.situations)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.situations.id, id));
      break;
  }

  const inserted = await db()
    .insert(schema.situationActions)
    .values({
      situationId: id,
      kind: body.kind,
      payload,
    })
    .returning({ id: schema.situationActions.id });

  return { situationId: id, actionId: inserted[0].id, kind: body.kind };
});
