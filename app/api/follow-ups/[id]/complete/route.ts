import { eq } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export const POST = withHandler(async (req) => {
  const id = req.nextUrl.pathname.split("/").slice(-2)[0];
  if (!id) throw new ClientError("Invalid id", 400);
  const updated = await db()
    .update(schema.followUps)
    .set({ completedAt: new Date() })
    .where(eq(schema.followUps.id, id))
    .returning({ id: schema.followUps.id });
  if (updated.length === 0) throw new ClientError("Not found", 404);
  return { id: updated[0].id };
});
