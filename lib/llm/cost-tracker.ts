/**
 * Dual-ledger cost tracker.
 *
 * Ported from `bart-app/server/lib/orchestrator.js:110-244` (_costLedger + createCostTracker).
 * Bart's version tracked input/output tokens only; we extend with prompt-cache counters
 * (cache_read_tokens, cache_write_tokens) since COS uses prompt caching where Bart did not.
 *
 * Records to both a global 24-hour rolling ledger AND a per-request tracker so individual
 * orchestrations can report their own spend independently of the global view.
 *
 * The DB-persisted version lives in `llm_usage` and is written by the LLM call sites.
 */

import { MODELS, type ModelKey } from "@/lib/llm/router";

export interface UsageRecord {
  modelKey: ModelKey;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  callCount: number;
}

export interface CostSnapshot {
  providers: Record<string, CostEntry>;
  totalCostUsd: number;
}

const GLOBAL_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

const globalLedger: Record<string, CostEntry> = {};
let globalLedgerResetAt = Date.now();

function ensureGlobalLedger(): void {
  if (Date.now() - globalLedgerResetAt > GLOBAL_RESET_INTERVAL_MS) {
    for (const key of Object.keys(globalLedger)) delete globalLedger[key];
    globalLedgerResetAt = Date.now();
  }
}

function computeCost(usage: UsageRecord): number {
  const model = MODELS[usage.modelKey];
  if (!model) return 0;
  // Anthropic prompt-caching pricing: writes 125% of input rate, reads 10% of input rate.
  const cacheWriteCost =
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * model.costPerMtokInput * 1.25;
  const cacheReadCost =
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * model.costPerMtokInput * 0.1;
  const inputCost = (usage.inputTokens / 1_000_000) * model.costPerMtokInput;
  const outputCost = (usage.outputTokens / 1_000_000) * model.costPerMtokOutput;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/** Public estimator used by the DB-persisted ledger (llm_usage) and the budget guard. */
export function estimateCostUsd(usage: UsageRecord): number {
  return computeCost(usage);
}

function addToEntry(target: Record<string, CostEntry>, usage: UsageRecord): void {
  const key = usage.modelKey;
  if (!target[key]) {
    target[key] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      callCount: 0,
    };
  }
  const entry = target[key];
  entry.inputTokens += usage.inputTokens;
  entry.outputTokens += usage.outputTokens;
  entry.cacheReadTokens += usage.cacheReadTokens ?? 0;
  entry.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  entry.estimatedCostUsd += computeCost(usage);
  entry.callCount += 1;
}

function snapshotOf(ledger: Record<string, CostEntry>): CostSnapshot {
  const providers: Record<string, CostEntry> = JSON.parse(JSON.stringify(ledger));
  let totalCostUsd = 0;
  for (const key of Object.keys(providers)) totalCostUsd += providers[key].estimatedCostUsd;
  return { providers, totalCostUsd: Math.round(totalCostUsd * 10000) / 10000 };
}

/** Record into the rolling 24h global ledger. */
export function recordGlobalUsage(usage: UsageRecord): void {
  ensureGlobalLedger();
  addToEntry(globalLedger, usage);
}

/** Snapshot of the global 24h rolling ledger. */
export function globalCostSnapshot(): CostSnapshot {
  ensureGlobalLedger();
  return snapshotOf(globalLedger);
}

export interface CostTracker {
  record(usage: UsageRecord): void;
  snapshot(): CostSnapshot;
}

/** Create a per-request tracker that also propagates to the global ledger. */
export function createCostTracker(): CostTracker {
  const ledger: Record<string, CostEntry> = {};
  return {
    record(usage) {
      addToEntry(ledger, usage);
      recordGlobalUsage(usage);
    },
    snapshot() {
      return snapshotOf(ledger);
    },
  };
}
