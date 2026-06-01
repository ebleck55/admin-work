import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db/client";
import { loadSeedContext } from "@/lib/chat/seed";

export const dynamic = "force-dynamic";

export default async function FromAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seed = await loadSeedContext("account", id);
  if (!seed) redirect("/accounts");

  const inserted = await db()
    .insert(schema.conversations)
    .values({
      title: seed.title,
      seedKind: "account",
      seedId: id,
      seedContext: seed.context,
    })
    .returning({ id: schema.conversations.id });

  redirect(`/chat/${inserted[0].id}`);
}
