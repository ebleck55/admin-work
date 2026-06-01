import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ChatThread } from "@/components/ChatThread";

export const dynamic = "force-dynamic";

export default async function ChatIndexPage() {
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

  // Create a fresh anonymous conversation for the chat surface.
  const newConvo = await db()
    .insert(schema.conversations)
    .values({ title: "New conversation" })
    .returning({ id: schema.conversations.id });

  return (
    <ChatThread
      conversationId={newConvo[0].id}
      conversationTitle="New conversation"
      initialMessages={[]}
      conversations={convos.map((c) => ({
        id: c.id,
        title: c.title,
        seedKind: c.seedKind,
        updatedAt: c.updatedAt.toISOString(),
      }))}
    />
  );
}
