/**
 * Durable spend ledger + daily budget guard.
 *
 * The in-memory cost tracker (lib/llm/cost-tracker.ts) resets on every serverless cold start,
 * so it cannot enforce a real budget. This module persists every call to the `llm_usage`
 * table and reads a rolling 24h spend total back from it to enforce a hard daily cap. The cap
 * is the real cost kill-switch; the in-memory tracker remains for per-request introspection.
 */

import { gte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { MODELS, type ModelKey } from "@/lib/llm/router";
import { estimateCostUsd, type UsageRecord } from "@/lib/llm/cost-tracker";

/** Thrown when a call would exceed the daily budget. Callers/handlers can special-case it. */
export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";
  constructor(spend: number, cap: number) {
    super(
      `Daily LLM budget exceeded: $${spend.toFixed(2)} of $${cap.toFixed(2)} cap in the last 24h. ` +
        `Raise COS_DAILY_USD_CAP to continue.`,
    );
  }
}

function dailyCapUsd(): number {
  const raw = process.env.COS_DAILY_USD_CAP;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50; // sane default
}

// Cache the rolling spend briefly so we don't issue a DB read on every single LLM call.
// This is a soft optimization; the DB row inserts remain the source of truth.
let cachedSpend: { value: number; at: number } | null = null;
const SPEND_TTL_MS = 30_000;
let lastAlertedBucket = -1;

/** Sum of estimated_cost_usd over the last 24h, cached for SPEND_TTL_MS. */
export async function getRollingSpendUsd(force = false): Promise<number> {
  if (!force && cachedSpend && Date.now() - cachedSpend.at < SPEND_TTL_MS) {
    return cachedSpend.value;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db()
    .select({ total: sql<number>`coalesce(sum(${schema.llmUsage.estimatedCostUsd}), 0)` })
    .from(schema.llmUsage)
    .where(gte(schema.llmUsage.createdAt, since));
  const value = Number(rows[0]?.total ?? 0);
  cachedSpend = { value, at: Date.now() };
  return value;
}

/**
 * Throw if the rolling 24h spend is at/over the cap. `essential` calls (interactive,
 * user-facing) may opt to bypass so the exec is never hard-blocked mid-conversation; set it
 * false for background jobs (briefings, synthesis, research) which should pause first.
 */
export async function assertWithinBudget(opts?: {
  essential?: boolean;
  purpose?: string;
}): Promise<void> {
  const cap = dailyCapUsd();
  const spend = await getRollingSpendUsd();
  // Threshold alerts at 50/80/100% (logged once per bucket per instance).
  const bucket = spend >= cap ? 100 : spend >= cap * 0.8 ? 80 : spend >= cap * 0.5 ? 50 : 0;
  if (bucket > 0 && bucket !== lastAlertedBucket) {
    lastAlertedBucket = bucket;
    console.warn(
      `[llm-budget] ALERT ${bucket}% of daily cap: $${spend.toFixed(2)} / $${cap.toFixed(2)}` +
        (opts?.purpose ? ` (purpose=${opts.purpose})` : ""),
    );
  }
  if (spend >= cap && !opts?.essential) {
    throw new BudgetExceededError(spend, cap);
  }
}

/**
 * Persist a single call to llm_usage. Fire-and-forget: never let a logging failure break the
 * actual LLM call. Updates the cached spend so the cap reacts without waiting for the TTL.
 */
export function persistUsage(record: {
  modelKey: ModelKey;
  usage: UsageRecord;
  purpose?: string;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
}): void {
  const model = MODELS[record.modelKey];
  const cost = estimateCostUsd(record.usage);
  if (cachedSpend) cachedSpend.value += cost; // optimistic; corrected on next refresh
  void db()
    .insert(schema.llmUsage)
    .values({
      provider: model?.provider ?? "unknown",
      model: model?.id ?? String(record.modelKey),
      purpose: record.purpose ?? "unspecified",
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      cacheReadTokens: record.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: record.usage.cacheWriteTokens ?? 0,
      estimatedCostUsd: cost,
      durationMs: record.durationMs ?? null,
      success: record.success,
      errorMessage: record.errorMessage ?? null,
    })
    .catch((err) => {
      console.error("[llm-budget] failed to persist llm_usage row:", err);
    });
}
