/**
 * Single-row user_preferences. GET reads (creates default row if missing),
 * PUT updates.
 */

import { eq } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

async function getOrCreate() {
  const rows = await db().select().from(schema.userPreferences).limit(1);
  if (rows.length > 0) return rows[0];
  const inserted = await db()
    .insert(schema.userPreferences)
    .values({})
    .returning();
  return inserted[0];
}

export const GET = withHandler(async () => {
  const row = await getOrCreate();
  return { preferences: row };
});

export const PUT = withHandler(async (req) => {
  const body = (await req.json()) as {
    minimumDealAmount?: number;
    preferredBriefingStyle?: string;
    excludedAccountIds?: string[];
    focusModules?: string[];
    notes?: string;
  };
  const current = await getOrCreate();
  const updateSet: Partial<typeof schema.userPreferences.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.minimumDealAmount !== undefined) {
    if (body.minimumDealAmount < 0) throw new ClientError("minimumDealAmount must be >= 0", 400);
    updateSet.minimumDealAmount = body.minimumDealAmount;
  }
  if (body.preferredBriefingStyle !== undefined)
    updateSet.preferredBriefingStyle = body.preferredBriefingStyle;
  if (body.excludedAccountIds !== undefined)
    updateSet.excludedAccountIds = body.excludedAccountIds;
  if (body.focusModules !== undefined) updateSet.focusModules = body.focusModules;
  if (body.notes !== undefined) updateSet.notes = body.notes;

  await db()
    .update(schema.userPreferences)
    .set(updateSet)
    .where(eq(schema.userPreferences.id, current.id));
  const rows = await db()
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.id, current.id))
    .limit(1);
  return { preferences: rows[0] };
});
