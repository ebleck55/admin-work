import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const sourceSystemEnum = pgEnum("source_system", [
  "outlook_email",
  "outlook_calendar",
  "slack",
  "zoom",
  "salesforce",
  "context_note",
]);

export const sensitivityEnum = pgEnum("sensitivity", ["public", "internal", "private_dm"]);

export const entityKindEnum = pgEnum("entity_kind", [
  "account",
  "opportunity",
  "contact",
  "rep",
  "initiative",
  "competitor",
]);

export const signalKindEnum = pgEnum("signal_kind", [
  "deal_risk",
  "expansion_opp",
  "churn_indicator",
  "coaching_moment",
  "regulatory_signal",
  "competitive_mention",
  "commitment",
  "escalation",
]);

export const signalSeverityEnum = pgEnum("signal_severity", ["low", "medium", "high", "critical"]);

export const briefingStatusEnum = pgEnum("briefing_status", ["complete", "partial", "failed"]);

export const moduleIdEnum = pgEnum("module_id", [
  "pipeline",
  "cs",
  "team",
  "initiatives",
  "finserv",
  "competitive",
  "priorities",
  "comms",
]);

// ---------------------------------------------------------------------------
// users — solo day 1, scaffolded for multi-user
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// evidence_ledger — append-only record of every payload ingested
// ---------------------------------------------------------------------------
export const evidenceLedger = pgTable(
  "evidence_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }).notNull(),
    actor: text("actor"),
    sensitivity: sensitivityEnum("sensitivity").default("internal").notNull(),
    confidence: real("confidence").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    sourcePayloadRef: text("source_payload_ref"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sourceUnique: uniqueIndex("evidence_ledger_source_unique").on(t.sourceSystem, t.sourceId),
    sourceTimestampIdx: index("evidence_ledger_source_timestamp_idx").on(t.sourceTimestamp),
    sensitivityIdx: index("evidence_ledger_sensitivity_idx").on(t.sensitivity),
  }),
);

// ---------------------------------------------------------------------------
// entities — polymorphic (account, opp, contact, rep, initiative, competitor)
// ---------------------------------------------------------------------------
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: entityKindEnum("kind").notNull(),
    name: text("name").notNull(),
    externalId: text("external_id"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    kindNameIdx: index("entities_kind_name_idx").on(t.kind, t.name),
    externalIdIdx: index("entities_external_id_idx").on(t.externalId),
  }),
);

// ---------------------------------------------------------------------------
// claims — structured statements extracted from a ledger row, linked to an entity
// ---------------------------------------------------------------------------
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .references(() => evidenceLedger.id, { onDelete: "cascade" })
      .notNull(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    moduleId: moduleIdEnum("module_id"),
    statement: text("statement").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
    confidence: real("confidence").notNull(),
    sensitivity: sensitivityEnum("sensitivity").default("internal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ledgerIdx: index("claims_ledger_idx").on(t.ledgerId),
    entityIdx: index("claims_entity_idx").on(t.entityId),
    moduleIdx: index("claims_module_idx").on(t.moduleId),
  }),
);

// ---------------------------------------------------------------------------
// evidence_quotes — raw quotes / snippets backing a claim, for citation rendering
// ---------------------------------------------------------------------------
export const evidenceQuotes = pgTable(
  "evidence_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .references(() => claims.id, { onDelete: "cascade" })
      .notNull(),
    quote: text("quote").notNull(),
    position: integer("position"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    claimIdx: index("evidence_quotes_claim_idx").on(t.claimId),
  }),
);

// ---------------------------------------------------------------------------
// documents — denormalized doc view (full transcripts/emails/threads) for display + embedding
// ---------------------------------------------------------------------------
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .references(() => evidenceLedger.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sensitivity: sensitivityEnum("sensitivity").default("internal").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ledgerIdx: index("documents_ledger_idx").on(t.ledgerId),
    sensitivityIdx: index("documents_sensitivity_idx").on(t.sensitivity),
  }),
);

// ---------------------------------------------------------------------------
// embeddings — pgvector chunks, sensitivity-flagged for RAG gating
// ---------------------------------------------------------------------------
export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    sensitivity: sensitivityEnum("sensitivity").default("internal").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    documentIdx: index("embeddings_document_idx").on(t.documentId),
    embeddingIdx: index("embeddings_vector_idx").using(
      "hnsw",
      sql`${t.embedding} vector_cosine_ops`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// signals — typed observations, each backed by claims → evidence
// ---------------------------------------------------------------------------
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: moduleIdEnum("module_id").notNull(),
    kind: signalKindEnum("kind").notNull(),
    severity: signalSeverityEnum("severity").default("medium").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    claimIds: jsonb("claim_ids").$type<string[]>().default([]).notNull(),
    sensitivity: sensitivityEnum("sensitivity").default("internal").notNull(),
    shareable: boolean("shareable").default(true).notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => ({
    moduleSeverityIdx: index("signals_module_severity_idx").on(t.moduleId, t.severity),
    entityIdx: index("signals_entity_idx").on(t.entityId),
    detectedAtIdx: index("signals_detected_at_idx").on(t.detectedAt),
    sensitivityIdx: index("signals_sensitivity_idx").on(t.sensitivity),
  }),
);

// ---------------------------------------------------------------------------
// briefings — generated artifacts (daily/weekly/exec); preload-or-on-demand pattern
// ---------------------------------------------------------------------------
export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: moduleIdEnum("module_id"),
    title: text("title").notNull(),
    forDate: timestamp("for_date", { withTimezone: true, mode: "date" }).notNull(),
    contentMd: text("content_md"),
    audioUrl: text("audio_url"),
    status: briefingStatusEnum("status").default("partial").notNull(),
    signalIds: jsonb("signal_ids").$type<string[]>().default([]).notNull(),
    sensitivity: sensitivityEnum("sensitivity").default("internal").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    durationMs: integer("duration_ms"),
    failedReason: text("failed_reason"),
  },
  (t) => ({
    moduleForDateIdx: index("briefings_module_for_date_idx").on(t.moduleId, t.forDate),
    statusIdx: index("briefings_status_idx").on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// notifications — in-app feed (day 1 delivery surface; replaces Slack DM)
// ---------------------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    severity: signalSeverityEnum("severity").default("medium").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userReadAtIdx: index("notifications_user_read_at_idx").on(t.userId, t.readAt),
  }),
);

// ---------------------------------------------------------------------------
// priorities — current unified feed (rank, reasoning, linked signals)
// ---------------------------------------------------------------------------
export const priorities = pgTable(
  "priorities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    reasoning: text("reasoning").notNull(),
    signalIds: jsonb("signal_ids").$type<string[]>().default([]).notNull(),
    forDate: timestamp("for_date", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    forDateRankIdx: uniqueIndex("priorities_for_date_rank_unique").on(t.forDate, t.rank),
  }),
);

// ---------------------------------------------------------------------------
// llm_usage — per-call cost ledger (dual-ledger pattern persisted)
// ---------------------------------------------------------------------------
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    purpose: text("purpose").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    estimatedCostUsd: real("estimated_cost_usd").default(0).notNull(),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerCreatedIdx: index("llm_usage_provider_created_idx").on(t.provider, t.createdAt),
    purposeIdx: index("llm_usage_purpose_idx").on(t.purpose),
  }),
);
