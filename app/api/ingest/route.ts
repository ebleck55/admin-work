import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { ClientError, withHandler } from "@/lib/api/handler";
import { inngest } from "@/inngest/client";
import { parseEnvelope } from "@/lib/ingestion/envelope";
import { writeEnvelope } from "@/lib/ingestion/ledger";
import { persistCalendarEvent } from "@/lib/ingestion/source-adapters/outlook-calendar";

export const runtime = "nodejs";
export const maxDuration = 60;

function requireBearer(req: NextRequest): void {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().COS_INGEST_TOKEN}`;
  if (header !== expected) {
    throw new ClientError("Unauthorized", 401);
  }
}

export const POST = withHandler(async (req) => {
  requireBearer(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ClientError("Body must be JSON", 400);
  }

  const parsed = parseEnvelope(body);
  if (!parsed.ok) throw new ClientError(parsed.error, 400);

  const writeResult = await writeEnvelope(parsed.data);

  // Secondary persistence for calendar events
  const calRes = await persistCalendarEvent(parsed.data);

  // Fire Inngest only for new rows so retries don't duplicate downstream work
  if (!writeResult.alreadyExists) {
    await inngest.send({
      name: "ingestion/payload.received",
      data: {
        ledgerId: writeResult.ledgerId,
        sourceSystem: parsed.data.source_system,
        sourceId: parsed.data.source_id,
        documentId: writeResult.documentId,
        claimIds: writeResult.claimIds,
        entityIds: writeResult.entityIds,
      },
    });
  }
  // Calendar prep generates whether the envelope is new or updated — re-runs
  // on event-edit are valuable
  if (calRes.calendarEventId) {
    await inngest.send({
      name: "calendar/meeting.prep.requested",
      data: { calendarEventId: calRes.calendarEventId },
    });
  }

  return {
    ledger_id: writeResult.ledgerId,
    already_exists: writeResult.alreadyExists,
    document_id: writeResult.documentId,
    claims: writeResult.claimIds.length,
    entities: writeResult.entityIds.length,
    redactions: writeResult.redactions,
    calendar_event_id: calRes.calendarEventId,
  };
});

// Default export so OPTIONS preflights don't fail in some deployments
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
