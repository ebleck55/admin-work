/**
 * Memory fact CRUD.
 *
 * GET — list all facts
 * POST — create a fact { kind, text, sourceMessageId?, sourceConversationId? }
 * DELETE ?id=… — remove a fact
 */

import { ClientError, withHandler } from "@/lib/api/handler";
import {
  addMemoryFact,
  deleteMemoryFact,
  listAllMemoryFacts,
  type MemoryKind,
} from "@/lib/chat/memory";

export const runtime = "nodejs";

const VALID_KINDS: MemoryKind[] = ["preference", "entity_fact", "decision", "context"];

export const GET = withHandler(async () => {
  const facts = await listAllMemoryFacts();
  return { facts };
});

export const POST = withHandler(async (req) => {
  const body = (await req.json()) as {
    kind?: MemoryKind;
    text?: string;
    sourceMessageId?: string;
    sourceConversationId?: string;
  };
  if (!body.text) throw new ClientError("text required", 400);
  if (!body.kind || !VALID_KINDS.includes(body.kind)) {
    throw new ClientError(`kind must be one of: ${VALID_KINDS.join(", ")}`, 400);
  }
  const fact = await addMemoryFact({
    kind: body.kind,
    text: body.text,
    sourceMessageId: body.sourceMessageId,
    sourceConversationId: body.sourceConversationId,
  });
  return { fact };
});

export const DELETE = withHandler(async (req) => {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) throw new ClientError("id query param required", 400);
  await deleteMemoryFact(id);
  return { deleted: id };
});
