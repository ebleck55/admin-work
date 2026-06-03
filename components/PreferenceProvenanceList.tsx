/**
 * Phase 15c: server component that renders the durable memory_facts that
 * contributed to a synthesis. Tiny wrapper around a SELECT so the calling
 * page can be a regular RSC.
 */

import { inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export async function PreferenceProvenanceList({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  let facts: Array<{ id: string; text: string; kind: string }> = [];
  try {
    facts = await db()
      .select({
        id: schema.memoryFacts.id,
        text: schema.memoryFacts.text,
        kind: schema.memoryFacts.kind,
      })
      .from(schema.memoryFacts)
      .where(inArray(schema.memoryFacts.id, ids));
  } catch {
    return null;
  }
  if (facts.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {facts.map((f) => (
        <li key={f.id} className="text-purple-900">
          · [{f.kind}] {f.text}
        </li>
      ))}
    </ul>
  );
}
