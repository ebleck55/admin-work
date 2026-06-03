/**
 * Phase 14c: fire an on-demand external research event for an account.
 *
 * GET returns the most recent research evidence ledger row (if any) so the
 * UI can render existing results without a re-run.
 * POST queues a fresh research run.
 */

import { desc, eq, sql } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

export const POST = withHandler(async (req) => {
  const id = req.nextUrl.pathname.split("/").slice(-2)[0];
  if (!id) throw new ClientError("Invalid id", 400);

  const accRows = await db()
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(eq(schema.entities.id, id))
    .limit(1);
  if (accRows.length === 0) throw new ClientError("Account not found", 404);

  await inngest.send({
    name: "research/account.requested",
    data: { accountId: id },
  });
  return { queued: true, accountId: id };
});

export const GET = withHandler(async (req) => {
  const id = req.nextUrl.pathname.split("/").slice(-2)[0];
  if (!id) throw new ClientError("Invalid id", 400);

  const rows = await db()
    .select({
      id: schema.evidenceLedger.id,
      sourceId: schema.evidenceLedger.sourceId,
      collectedAt: schema.evidenceLedger.collectedAt,
      rawPayload: schema.evidenceLedger.rawPayload,
    })
    .from(schema.evidenceLedger)
    .where(
      sql`${schema.evidenceLedger.sourceSystem} = 'web_research' AND ${schema.evidenceLedger.rawPayload}->>'account_id' = ${id}`,
    )
    .orderBy(desc(schema.evidenceLedger.collectedAt))
    .limit(1);

  if (rows.length === 0) return { research: null };
  return { research: rows[0] };
});
