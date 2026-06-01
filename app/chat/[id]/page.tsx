import { asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db, schema } from "@/lib/db/client";
import { ChatThread } from "@/components/ChatThread";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const convoRows = await db()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .limit(1);
  if (convoRows.length === 0) notFound();
  const convo = convoRows[0];

  const msgs = await db()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(asc(schema.messages.createdAt));

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

  return (
    <ChatThread
      conversationId={id}
      conversationTitle={convo.title}
      initialMessages={msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        retrievalHits: (m.retrievalHits as unknown[]) as never,
        memoryHits: (m.memoryHits as unknown[]) as never,
      }))}
      conversations={convos.map((c) => ({
        id: c.id,
        title: c.title,
        seedKind: c.seedKind,
        updatedAt: c.updatedAt.toISOString(),
      }))}
    />
  );
}
