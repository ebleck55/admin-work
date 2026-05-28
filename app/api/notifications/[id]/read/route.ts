import { eq } from "drizzle-orm";

import { withHandler, ClientError } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export const POST = withHandler(async (req) => {
  const id = req.nextUrl.pathname.split("/").at(-2);
  if (!id || id.length < 8) throw new ClientError("Invalid notification id", 400);
  const updated = await db()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(eq(schema.notifications.id, id))
    .returning({ id: schema.notifications.id, readAt: schema.notifications.readAt });
  if (updated.length === 0) throw new ClientError("Notification not found", 404);
  return { id: updated[0].id, readAt: updated[0].readAt };
});
