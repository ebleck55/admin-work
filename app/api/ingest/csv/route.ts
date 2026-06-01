/**
 * CSV ingest endpoint. The Mac sync agent POSTs Salesforce CSV exports here; this route
 * parses, maps to envelopes, and fans them into the standard ingestion path.
 *
 * Why a separate endpoint and not /api/ingest with a smarter parser? CSV needs file_date
 * context (one upload = many envelopes, all sharing the same snapshot date) — putting that
 * concern in the canonical envelope route would muddy its single-payload semantics.
 */

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { ClientError, withHandler } from "@/lib/api/handler";
import { inngest } from "@/inngest/client";
import { parseSalesforceCsv } from "@/lib/ingestion/source-adapters/salesforce-csv";
import { writeEnvelope } from "@/lib/ingestion/ledger";

export const runtime = "nodejs";
export const maxDuration = 300;

function requireBearer(req: NextRequest): void {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().COS_INGEST_TOKEN}`;
  if (header !== expected) throw new ClientError("Unauthorized", 401);
}

export const POST = withHandler(async (req) => {
  requireBearer(req);

  const fileDate = req.nextUrl.searchParams.get("file_date") ?? new Date().toISOString().slice(0, 10);
  const csv = await req.text();
  if (!csv.trim()) throw new ClientError("Empty CSV body", 400);

  let result;
  try {
    result = parseSalesforceCsv(csv, fileDate);
  } catch (err) {
    throw new ClientError(
      `CSV parse failed: ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }

  const written = {
    new: 0,
    duplicate: 0,
    failed: 0,
    ledgerIds: [] as string[],
    errors: [] as string[],
  };

  const BATCH_SIZE = 10;
  const ingestionEvents: Array<{
    name: "ingestion/payload.received";
    data: {
      ledgerId: string;
      sourceSystem: string;
      sourceId: string;
      documentId?: string;
      claimIds: string[];
      entityIds: string[];
    };
  }> = [];

  for (let i = 0; i < result.envelopes.length; i += BATCH_SIZE) {
    const batch = result.envelopes.slice(i, i + BATCH_SIZE);
    const writes = await Promise.allSettled(batch.map((e) => writeEnvelope(e)));
    for (let j = 0; j < writes.length; j++) {
      const envlp = batch[j];
      const r = writes[j];
      if (r.status === "rejected") {
        written.failed += 1;
        written.errors.push(
          `${envlp.source_id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
        continue;
      }
      const w = r.value;
      if (w.alreadyExists) {
        written.duplicate += 1;
        continue;
      }
      written.new += 1;
      written.ledgerIds.push(w.ledgerId);
      ingestionEvents.push({
        name: "ingestion/payload.received",
        data: {
          ledgerId: w.ledgerId,
          sourceSystem: envlp.source_system,
          sourceId: envlp.source_id,
          documentId: w.documentId,
          claimIds: w.claimIds,
          entityIds: w.entityIds,
        },
      });
    }
  }

  // Batch-fire Inngest events (one HTTP call per chunk instead of per envelope)
  if (ingestionEvents.length > 0) {
    const EVENT_BATCH = 50;
    for (let i = 0; i < ingestionEvents.length; i += EVENT_BATCH) {
      await inngest.send(ingestionEvents.slice(i, i + EVENT_BATCH));
    }
  }

  return {
    file_date: fileDate,
    rows_read: result.rowsRead,
    rows_skipped: result.rowsSkipped,
    envelopes: result.envelopes.length,
    written,
  };
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
