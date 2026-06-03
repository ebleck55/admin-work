/**
 * "Ask Claude about this situation" entry point. Creates a new conversation
 * with the situation context loaded as the seed, then redirects to the chat.
 *
 * Phase 14b: optional ?prompt query param pre-fills the first user message
 * so callers (e.g., "Draft team comms" button on SituationCard) can land
 * directly in the right thread without typing.
 */

import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db/client";
import { loadSeedContext } from "@/lib/chat/seed";

export const dynamic = "force-dynamic";

export default async function FromSituationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { id } = await params;
  const { prompt } = await searchParams;
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

  const target = prompt
    ? `/chat/${inserted[0].id}?prompt=${encodeURIComponent(prompt)}`
    : `/chat/${inserted[0].id}`;
  redirect(target);
}
