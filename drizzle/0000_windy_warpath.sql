CREATE TYPE "public"."briefing_status" AS ENUM('complete', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('account', 'opportunity', 'contact', 'rep', 'initiative', 'competitor');--> statement-breakpoint
CREATE TYPE "public"."module_id" AS ENUM('pipeline', 'cs', 'team', 'initiatives', 'finserv', 'competitive', 'priorities', 'comms');--> statement-breakpoint
CREATE TYPE "public"."sensitivity" AS ENUM('public', 'internal', 'private_dm');--> statement-breakpoint
CREATE TYPE "public"."signal_kind" AS ENUM('deal_risk', 'expansion_opp', 'churn_indicator', 'coaching_moment', 'regulatory_signal', 'competitive_mention', 'commitment', 'escalation');--> statement-breakpoint
CREATE TYPE "public"."signal_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('outlook_email', 'outlook_calendar', 'slack', 'zoom', 'salesforce', 'context_note');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" "module_id",
	"title" text NOT NULL,
	"for_date" timestamp with time zone NOT NULL,
	"content_md" text,
	"audio_url" text,
	"status" "briefing_status" DEFAULT 'partial' NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'internal' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"failed_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"entity_id" uuid,
	"module_id" "module_id",
	"statement" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'internal' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'internal' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"name" text NOT NULL,
	"external_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text,
	"collected_at" timestamp with time zone NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"actor" text,
	"sensitivity" "sensitivity" DEFAULT 'internal' NOT NULL,
	"confidence" real NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"source_payload_ref" text,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"success" boolean NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"signal_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"severity" "signal_severity" DEFAULT 'medium' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"reasoning" text NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"for_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" "module_id" NOT NULL,
	"kind" "signal_kind" NOT NULL,
	"severity" "signal_severity" DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"entity_id" uuid,
	"claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'internal' NOT NULL,
	"shareable" boolean DEFAULT true NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expired_at" timestamp with time zone,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_ledger_id_evidence_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."evidence_ledger"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_ledger_id_evidence_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."evidence_ledger"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_quotes" ADD CONSTRAINT "evidence_quotes_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefings_module_for_date_idx" ON "briefings" USING btree ("module_id","for_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefings_status_idx" ON "briefings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_ledger_idx" ON "claims" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_entity_idx" ON "claims" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_module_idx" ON "claims" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_ledger_idx" ON "documents" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_sensitivity_idx" ON "documents" USING btree ("sensitivity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_document_idx" ON "embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_vector_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_kind_name_idx" ON "entities" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_external_id_idx" ON "entities" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evidence_ledger_source_unique" ON "evidence_ledger" USING btree ("source_system","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_ledger_source_timestamp_idx" ON "evidence_ledger" USING btree ("source_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_ledger_sensitivity_idx" ON "evidence_ledger" USING btree ("sensitivity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_quotes_claim_idx" ON "evidence_quotes" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_provider_created_idx" ON "llm_usage" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_purpose_idx" ON "llm_usage" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_read_at_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "priorities_for_date_rank_unique" ON "priorities" USING btree ("for_date","rank");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_module_severity_idx" ON "signals" USING btree ("module_id","severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_entity_idx" ON "signals" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_detected_at_idx" ON "signals" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_sensitivity_idx" ON "signals" USING btree ("sensitivity");