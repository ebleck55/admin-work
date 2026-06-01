/**
 * Adapter: extracts calendar event metadata from an Outlook calendar
 * envelope and persists it as a calendar_events row.
 *
 * Called by writeEnvelope's secondary persistence step when the envelope's
 * source_system is "outlook_calendar" and a calendar_event attribute is
 * present.
 */

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import type { PayloadEnvelope } from "@/lib/ingestion/envelope";

interface CalendarEventAttrs {
  start_at: string;
  end_at: string;
  attendees?: Array<{ email?: string; name?: string; is_self?: boolean }>;
  location?: string;
  description?: string;
}

function extractCalendarAttrs(env: PayloadEnvelope): CalendarEventAttrs | null {
  // We allow either a top-level claims attribute "calendar_event" OR a
  // dedicated envelope.attributes pass-through. Tolerate either source.
  for (const c of env.claims) {
    const ev = c.attributes?.calendar_event;
    if (ev && typeof ev === "object") {
      return ev as CalendarEventAttrs;
    }
  }
  return null;
}

export async function persistCalendarEvent(
  env: PayloadEnvelope,
): Promise<{ created: boolean; calendarEventId?: string }> {
  if (env.source_system !== "outlook_calendar") return { created: false };
  const attrs = extractCalendarAttrs(env);
  if (!attrs || !attrs.start_at || !attrs.end_at) return { created: false };

  // Resolve account entity IDs from envelope.entities
  const accountEntityIds: string[] = [];
  const accountNames = env.entities
    .filter((e) => e.kind === "account")
    .map((e) => e.name);
  if (accountNames.length > 0) {
    const rows = await db()
      .select({ id: schema.entities.id, name: schema.entities.name })
      .from(schema.entities)
      .where(
        inArray(schema.entities.name, accountNames),
      );
    for (const r of rows) accountEntityIds.push(r.id);
  }

  // Idempotency: skip if calendar event already exists for this source_id
  const existing = await db()
    .select({ id: schema.calendarEvents.id })
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.sourceId, env.source_id))
    .limit(1);

  if (existing.length > 0) {
    // Update mutable fields (attendees, location may change)
    await db()
      .update(schema.calendarEvents)
      .set({
        title: env.title ?? "(untitled)",
        startAt: new Date(attrs.start_at),
        endAt: new Date(attrs.end_at),
        attendees: attrs.attendees ?? [],
        location: attrs.location ?? null,
        description: attrs.description ?? null,
        accountEntityIds,
      })
      .where(eq(schema.calendarEvents.sourceId, env.source_id));
    return { created: false, calendarEventId: existing[0].id };
  }

  const inserted = await db()
    .insert(schema.calendarEvents)
    .values({
      sourceId: env.source_id,
      title: env.title ?? "(untitled)",
      startAt: new Date(attrs.start_at),
      endAt: new Date(attrs.end_at),
      attendees: attrs.attendees ?? [],
      location: attrs.location ?? null,
      description: attrs.description ?? null,
      accountEntityIds,
      sensitivity: env.sensitivity,
    })
    .returning({ id: schema.calendarEvents.id });

  return { created: true, calendarEventId: inserted[0].id };
}
