/**
 * Follow-up CRUD: lets Eric create a date-bound action item from any surface
 * (situation, account, or free-form note). Home page renders the "due today
 * or earlier" set.
 */

import { and, asc, eq, isNull, lte } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const VALID_SOURCE_KINDS = new Set(["situation", "signal", "account", "note"]);

export const POST = withHandler(async (req) => {
  const body = (await req.json()) as {
    title?: string;
    dueAt?: string;
    sourceKind?: string;
    sourceId?: string;
    note?: string;
  };
  if (!body.title) throw new ClientError("title required", 400);
  if (!body.dueAt) throw new ClientError("dueAt (ISO date) required", 400);
  const due = new Date(body.dueAt);
  if (Number.isNaN(due.getTime())) throw new ClientError("dueAt is invalid", 400);

  const sourceKind = body.sourceKind ?? "note";
  if (!VALID_SOURCE_KINDS.has(sourceKind)) {
    throw new ClientError(`sourceKind must be one of: ${Array.from(VALID_SOURCE_KINDS).join(", ")}`, 400);
  }

  const inserted = await db()
    .insert(schema.followUps)
    .values({
      title: body.title,
      dueAt: due,
      sourceKind,
      sourceId: body.sourceId ?? null,
      note: body.note ?? null,
    })
    .returning({ id: schema.followUps.id });
  return { id: inserted[0].id };
});

export const GET = withHandler(async (req) => {
  const all = req.nextUrl.searchParams.get("scope") === "all";
  const rows = all
    ? await db().select().from(schema.followUps).orderBy(asc(schema.followUps.dueAt)).limit(100)
    : await db()
        .select()
        .from(schema.followUps)
        .where(
          and(
            isNull(schema.followUps.completedAt),
            lte(schema.followUps.dueAt, new Date()),
          ),
        )
        .orderBy(asc(schema.followUps.dueAt))
        .limit(50);
  return { followUps: rows };
});
