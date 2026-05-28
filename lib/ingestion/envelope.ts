import { z } from "zod";

export const EntityRef = z.object({
  kind: z.enum(["account", "opportunity", "contact", "rep", "initiative", "competitor"]),
  name: z.string().min(1),
  external_id: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});
export type EntityRef = z.infer<typeof EntityRef>;

export const Claim = z.object({
  statement: z.string().min(1),
  module_id: z
    .enum(["pipeline", "cs", "team", "initiatives", "finserv", "competitive", "priorities", "comms"])
    .optional(),
  entity_ref: EntityRef.optional(),
  attributes: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).default(0.7),
});
export type Claim = z.infer<typeof Claim>;

export const Evidence = z.object({
  claim_index: z.number().int().min(0),
  quote: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const SourceSystem = z.enum([
  "outlook_email",
  "outlook_calendar",
  "slack",
  "zoom",
  "salesforce",
  "context_note",
]);
export type SourceSystem = z.infer<typeof SourceSystem>;

export const Sensitivity = z.enum(["public", "internal", "private_dm"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

/**
 * Canonical payload envelope. Every payload entering the system — Codex direct POST,
 * sync agent upload, or manual UI drop — conforms to this shape. Validated at /api/ingest.
 */
export const PayloadEnvelope = z.object({
  source_system: SourceSystem,
  source_id: z.string().min(1),
  source_url: z.string().url().optional(),
  collected_at: z.string().datetime(),
  source_timestamp: z.string().datetime(),
  actor: z.string().optional(),
  sensitivity: Sensitivity.default("internal"),
  entities: z.array(EntityRef).default([]),
  claims: z.array(Claim).default([]),
  evidence: z.array(Evidence).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
  source_payload_ref: z.string().optional(),

  /** Free-form raw content (email body, transcript, etc.) — embedded for RAG. */
  raw_text: z.string().optional(),
  /** Display title for the document derived from this envelope. */
  title: z.string().optional(),
});
export type PayloadEnvelope = z.infer<typeof PayloadEnvelope>;

/**
 * Light validation helper that returns either parsed data or a human-readable error string.
 */
export function parseEnvelope(input: unknown):
  | { ok: true; data: PayloadEnvelope }
  | { ok: false; error: string } {
  const result = PayloadEnvelope.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `Invalid envelope: ${issues}` };
}
