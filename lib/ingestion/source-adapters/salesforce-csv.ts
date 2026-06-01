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
  // Opportunity ID
  "opportunity id": "opportunity_id",
  "opp id": "opportunity_id",
  "18-digit opportunity id": "opportunity_id",
  "id": "opportunity_id",
  // Opportunity name
  "opportunity name": "opportunity_name",
  "opp name": "opportunity_name",
  // Account
  "account name": "account_name",
  "account": "account_name",
  "account id": "account_id",
  // Stage / forecast
  "stage": "stage",
  "stage name": "stage",
  "forecast category": "forecast_category",
  "forecast category name": "forecast_category",
  "type": "type",
  "fiscal period": "fiscal_period",
  "territory region": "territory_region",
  // Amount (generic + UiPath FS-specific fields)
  "amount": "amount",
  "total amount": "amount",
  "billed iarr": "billed_iarr",
  "billed iarr best-case incremental": "billed_iarr_best_case",
  "arr to renew": "arr_to_renew",
  "billed downsell iarr": "billed_downsell_iarr",
  // Dates
  "close date": "close_date",
  "last activity date": "last_activity_date",
  "last activity": "last_activity_date",
  // Probability
  "probability": "probability",
  "probability (%)": "probability",
  // Owner
  "owner": "owner",
  "opportunity owner": "owner",
  "owner full name": "owner",
  // Next step
  "next step": "next_step",
  "opportunity next steps": "next_step",
  // Sensitivity
  "internal only": "internal_only",
};

interface NormalizedRow {
  opportunity_id?: string;
  opportunity_name?: string;
  account_name?: string;
  account_id?: string;
  stage?: string;
  amount?: string;
  billed_iarr?: string;
  billed_iarr_best_case?: string;
  arr_to_renew?: string;
  billed_downsell_iarr?: string;
  close_date?: string;
  probability?: string;
  owner?: string;
  last_activity_date?: string;
  next_step?: string;
  forecast_category?: string;
  type?: string;
  fiscal_period?: string;
  territory_region?: string;
  internal_only?: string;
  [key: string]: string | undefined;
}

function normalizeHeader(h: string): string {
  return HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$,€£¥]/g, "").trim();
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

/**
 * Derive a stable source_id when Salesforce export doesn't include Opportunity ID.
 * Uses Account + Opportunity Name (joined with §) — unique enough for the FS GTM
 * report shape and stable across re-exports.
 */
function deriveSourceId(row: NormalizedRow): string | null {
  if (row.opportunity_id) return row.opportunity_id;
  if (row.opportunity_name && row.account_name) {
    return `${row.account_name}§${row.opportunity_name}`;
  }
  if (row.opportunity_name) return row.opportunity_name;
  return null;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function rowToEnvelope(row: NormalizedRow, fileDate: string): PayloadEnvelope | null {
  const sourceId = deriveSourceId(row);
  if (!sourceId) return null;

  const entities: EntityRef[] = [];
  if (row.opportunity_name) {
    entities.push({
      kind: "opportunity",
      name: row.opportunity_name,
      external_id: row.opportunity_id,
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
  const oppLabel = row.opportunity_name ?? sourceId;

  const amount = parseAmount(row.amount);
  const billedIarr = parseAmount(row.billed_iarr);
  const billedIarrBestCase = parseAmount(row.billed_iarr_best_case);
  const arrToRenew = parseAmount(row.arr_to_renew);
  const billedDownsell = parseAmount(row.billed_downsell_iarr);

  if (row.stage) {
    claims.push({
      statement: `${oppLabel} is in stage "${row.stage}".`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "stage", stage: row.stage },
      confidence: conf,
    });
  }
  if (amount !== undefined) {
    claims.push({
      statement: `${oppLabel} total amount: ${fmtUsd(amount)}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "amount", amount },
      confidence: conf,
    });
  }
  if (billedIarr !== undefined) {
    claims.push({
      statement: `${oppLabel} billed iARR: ${fmtUsd(billedIarr)}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "billed_iarr", amount: billedIarr },
      confidence: conf,
    });
  }
  if (billedIarrBestCase !== undefined) {
    claims.push({
      statement: `${oppLabel} best-case incremental iARR upside: ${fmtUsd(billedIarrBestCase)}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "billed_iarr_best_case", amount: billedIarrBestCase },
      confidence: conf,
    });
  }
  if (arrToRenew !== undefined) {
    claims.push({
      statement: `${oppLabel} ARR to renew: ${fmtUsd(arrToRenew)}.`,
      module_id: "cs",
      entity_ref: accountRef ?? oppRef,
      attributes: { field: "arr_to_renew", amount: arrToRenew },
      confidence: conf,
    });
  }
  if (billedDownsell !== undefined && billedDownsell !== 0) {
    claims.push({
      statement: `${oppLabel} billed downsell iARR risk: ${fmtUsd(billedDownsell)}.`,
      module_id: "cs",
      entity_ref: accountRef ?? oppRef,
      attributes: { field: "billed_downsell_iarr", amount: billedDownsell },
      confidence: conf,
    });
  }
  if (row.close_date) {
    claims.push({
      statement: `${oppLabel} close date: ${row.close_date}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "close_date", close_date: row.close_date },
      confidence: conf,
    });
  }
  if (row.last_activity_date) {
    claims.push({
      statement: `${oppLabel} last activity on ${row.last_activity_date}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "last_activity_date", last_activity_date: row.last_activity_date },
      confidence: conf,
    });
  }
  if (row.next_step) {
    claims.push({
      statement: `Next step on ${oppLabel}: ${row.next_step}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "next_step", next_step: row.next_step },
      confidence: conf,
    });
  }
  if (row.forecast_category) {
    claims.push({
      statement: `${oppLabel} forecast category: ${row.forecast_category}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "forecast_category", forecast_category: row.forecast_category },
      confidence: conf,
    });
  }
  if (row.type) {
    claims.push({
      statement: `${oppLabel} type: ${row.type}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "type", type: row.type },
      confidence: conf,
    });
  }
  if (row.fiscal_period) {
    claims.push({
      statement: `${oppLabel} fiscal period: ${row.fiscal_period}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "fiscal_period", fiscal_period: row.fiscal_period },
      confidence: conf,
    });
  }
  if (row.territory_region) {
    claims.push({
      statement: `${oppLabel} territory: ${row.territory_region}.`,
      module_id: "pipeline",
      entity_ref: oppRef ?? accountRef,
      attributes: { field: "territory_region", territory_region: row.territory_region },
      confidence: conf,
    });
  }

  if (claims.length === 0) return null;

  return {
    source_system: "salesforce",
    source_id: `${sourceId}@${fileDate}`,
    collected_at: new Date().toISOString(),
    source_timestamp: row.close_date ? new Date(row.close_date).toISOString() : new Date().toISOString(),
    actor: row.owner,
    sensitivity: isYes(row.internal_only) ? "private_dm" : "internal",
    entities,
    claims,
    evidence: [],
    confidence: conf,
    raw_text: undefined,
    title: row.opportunity_name ?? sourceId,
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
