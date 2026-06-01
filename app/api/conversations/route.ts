/**
 * Create or list conversations.
 *
 * POST body: { seedKind?, seedId?, title?, firstMessage? } — creates a new
 * conversation and (if firstMessage is present) seeds it with a user message
 * that the /chat/[id]/stream endpoint will then process on first GET.
 *
 * GET — list recent conversations (sidebar).
 */

import { desc } from "drizzle-orm";

import { ClientError, withHandler } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";
import { loadSeedContext, type SeedKind } from "@/lib/chat/seed";

export const runtime = "nodejs";

const VALID_SEEDS: SeedKind[] = ["situation", "signal", "account", "meeting"];

export const POST = withHandler(async (req) => {
  const body = (await req.json().catch(() => ({}))) as {
    seedKind?: SeedKind;
    seedId?: string;
    title?: string;
  };

  let title = body.title ?? "New conversation";
  let seedContext: string | null = null;

  if (body.seedKind && body.seedId) {
    if (!VALID_SEEDS.includes(body.seedKind)) {
      throw new ClientError(`Invalid seedKind. Expected one of: ${VALID_SEEDS.join(", ")}`, 400);
    }
    const seed = await loadSeedContext(body.seedKind, body.seedId);
    if (!seed) throw new ClientError(`${body.seedKind} ${body.seedId} not found`, 404);
    title = seed.title;
    seedContext = seed.context;
  }

  const inserted = await db()
    .insert(schema.conversations)
    .values({
      title,
      seedKind: body.seedKind ?? null,
      seedId: body.seedId ?? null,
      seedContext,
    })
    .returning({ id: schema.conversations.id });

  return { id: inserted[0].id, title };
});

export const GET = withHandler(async () => {
  const convos = await db()
    .select({
      id: schema.conversations.id,
      title: schema.conversations.title,
      seedKind: schema.conversations.seedKind,
      updatedAt: schema.conversations.updatedAt,
    })
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(50);
  return { conversations: convos };
});
