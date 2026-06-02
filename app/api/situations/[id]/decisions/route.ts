/**
 * Record a decision frame choice. POST { optionLabel } — logs into
 * situation_actions with kind='decision' so Claude can reference Eric's
 * choice in future chats and the action history reflects it.
 */

import { eq } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export const POST = withHandler(async (req) => {
  const id = req.nextUrl.pathname.split("/").slice(-2)[0];
  if (!id) throw new ClientError("Invalid id", 400);

  const body = (await req.json()) as { optionLabel?: string };
  if (!body.optionLabel) throw new ClientError("optionLabel required", 400);

  const rows = await db()
    .select({ decisionFrame: schema.situations.decisionFrame })
    .from(schema.situations)
    .where(eq(schema.situations.id, id))
    .limit(1);
  if (rows.length === 0) throw new ClientError("Situation not found", 404);
  if (!rows[0].decisionFrame) throw new ClientError("Situation has no decision frame", 400);

  const valid = rows[0].decisionFrame.options.find((o) => o.label === body.optionLabel);
  if (!valid) throw new ClientError(`Invalid option. Must be one of: ${rows[0].decisionFrame.options.map((o) => o.label).join(" | ")}`, 400);

  const inserted = await db()
    .insert(schema.situationActions)
    .values({
      situationId: id,
      kind: "decision",
      payload: {
        optionLabel: body.optionLabel,
        question: rows[0].decisionFrame.question,
      },
    })
    .returning({ id: schema.situationActions.id });

  return { id: inserted[0].id, chosen: body.optionLabel };
});
