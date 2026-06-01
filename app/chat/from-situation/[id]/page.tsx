/**
 * "Ask Claude about this situation" entry point. Creates a new conversation
 * with the situation context loaded as the seed, then redirects to the chat.
 */

import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db/client";
import { loadSeedContext } from "@/lib/chat/seed";

export const dynamic = "force-dynamic";

export default async function FromSituationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seed = await loadSeedContext("situation", id);
  if (!seed) redirect("/situations");

  const inserted = await db()
    .insert(schema.conversations)
    .values({
      title: seed.title,
      seedKind: "situation",
      seedId: id,
      seedContext: seed.context,
    })
    .returning({ id: schema.conversations.id });

  redirect(`/chat/${inserted[0].id}`);
}
