/**
 * Salesforce CSV → canonical envelope adapter.
 *
 * Eric exports the "FS GTM — Open Pipeline (Full)" report (or equivalent) as CSV,
 * drops it in ~/Desktop/chief of staff app/, the sync agent uploads it to
 * /api/ingest/csv, this adapter parses + maps each row to a payload envelope,
 * and the standard /api/ingest path takes it from there.
 *
 * One row = one envelope, with one claim per non-empty Salesforce field, all
 * sharing the same source_id (opportunity id). Re-uploading the same file is
 * safe because envelope ingestion is idempotent on (source_system, source_id).
 *
 * To re-ingest stale rows after data has changed, the file_date suffix is
 * appended to source_id so a new export creates new ledger rows.
 */

import { parse } from "csv-parse/sync";

import type { PayloadEnvelope, Claim, EntityRef } from "@/lib/ingestion/envelope";

const HEADER_ALIASES: Record<string, string> = {
  "opportunity id": "opportunity_id",
  "opp id": "opportunity_id",
  "opportunity name": "opportunity_name",
  "opp name": "opportunity_name",
  "account name": "account_name",
  "account": "account_name",
  "account id": "account_id",
  "stage": "stage",
  "amount": "amount",
  "close date": "close_date",
  "probability": "probability",
  "owner": "owner",
  "last activity date": "last_activity_date",
  "next step": "next_step",
  "forecast category": "forecast_category",
  "internal only": "internal_only",
};

interface NormalizedRow {
  opportunity_id?: string;
  opportunity_name?: string;
  account_name?: string;
  account_id?: string;
  stage?: string;
  amount?: string;
  close_date?: string;
  probability?: string;
  owner?: string;
  last_activity_date?: string;
  next_step?: string;
  forecast_category?: string;
  internal_only?: string;
  [key: string]: string | undefined;
}

function normalizeHeader(h: string): string {
  return HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseProbability(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/%/g, "").trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return n > 1 ? n / 100 : n;
}

function isYes(raw: string | undefined): boolean {
  if (!raw) return false;
  return /^(yes|y|true|1)$/i.test(raw.trim());
}

function rowToEnvelope(row: NormalizedRow, fileDate: string): PayloadEnvelope | null {
  const oppId = row.opportunity_id;
  if (!oppId) return null;

  const entities: EntityRef[] = [];
  if (row.opportunity_name) {
    entities.push({
      kind: "opportunity",
      name: row.opportunity_name,
      external_id: oppId,
    });
  }
  if (row.account_name) {
    entities.push({
      kind: "account",
      name: row.account_name,
      external_id: row.account_id,
    });
  }
  if (row.owner) {
    entities.push({ kind: "rep", name: row.owner });
  }

  const accountRef: EntityRef | undefined = row.account_name
    ? { kind: "account", name: row.account_name }
    : undefined;
  const oppRef: EntityRef | undefined = row.opportunity_name
    ? { kind: "opportunity", name: row.opportunity_name }
    : undefined;

  const claims: Claim[] = [];
  const conf = parseProbability(row.probability) ?? 0.7;
  const amount = parseAmount(row.amount);

  if (row.stage) {
    claims.push({
      statement: `${row.opportunity_name ?? oppId} is in stage "${row.stage}".`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "stage", stage: row.stage },
      confidence: conf,
    });
  }
  if (amount !== undefined) {
    claims.push({
      statement: `${row.opportunity_name ?? oppId} has amount ${amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "amount", amount },
      confidence: conf,
    });
  }
  if (row.close_date) {
    claims.push({
      statement: `${row.opportunity_name ?? oppId} close date: ${row.close_date}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "close_date", close_date: row.close_date },
      confidence: conf,
    });
  }
  if (row.last_activity_date) {
    claims.push({
      statement: `${row.opportunity_name ?? oppId} last activity on ${row.last_activity_date}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "last_activity_date", last_activity_date: row.last_activity_date },
      confidence: conf,
    });
  }
  if (row.next_step) {
    claims.push({
      statement: `Next step on ${row.opportunity_name ?? oppId}: ${row.next_step}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "next_step", next_step: row.next_step },
      confidence: conf,
    });
  }
  if (row.forecast_category) {
    claims.push({
      statement: `${row.opportunity_name ?? oppId} forecast category: ${row.forecast_category}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "forecast_category", forecast_category: row.forecast_category },
      confidence: conf,
    });
  }

  if (claims.length === 0) return null;

  return {
    source_system: "salesforce",
    source_id: `${oppId}@${fileDate}`,
    collected_at: new Date().toISOString(),
    source_timestamp: row.close_date ? new Date(row.close_date).toISOString() : new Date().toISOString(),
    actor: row.owner,
    sensitivity: isYes(row.internal_only) ? "private_dm" : "internal",
    entities,
    claims,
    evidence: [],
    confidence: conf,
    raw_text: undefined,
    title: row.opportunity_name ?? oppId,
  };
}

export interface CsvParseResult {
  envelopes: PayloadEnvelope[];
  rowsRead: number;
  rowsSkipped: number;
  skippedReasons: string[];
}

/**
 * Parse a Salesforce pipeline CSV blob and emit one envelope per row that has a usable
 * opportunity_id + at least one claim-producing field. `fileDate` is appended to source_id
 * so successive snapshots produce new ledger rows.
 */
export function parseSalesforceCsv(csv: string, fileDate: string): CsvParseResult {
  const records = parse(csv, {
    columns: (headers: string[]) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    trim: true,
  }) as NormalizedRow[];

  const envelopes: PayloadEnvelope[] = [];
  let skipped = 0;
  const skippedReasons: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const envelope = rowToEnvelope(row, fileDate);
    if (!envelope) {
      skipped += 1;
      skippedReasons.push(`Row ${i + 1}: missing opportunity_id or all claim-producing fields`);
      continue;
    }
    envelopes.push(envelope);
  }

  return { envelopes, rowsRead: records.length, rowsSkipped: skipped, skippedReasons };
}
