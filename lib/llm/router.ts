/**
 * Model registry and task router.
 *
 * Ported from `bart-app/server/lib/orchestrator.js:36-85` (MODELS map) and
 * `:2927+` (4-tier routing). Adapted from Bart's 4 conversation modes
 * (fast/chat/deep-think/image-video) to the COS task taxonomy.
 *
 * Models follow the recommendations in the platform plan:
 *   classify -> Haiku 4.5
 *   extract  -> Sonnet 4.6
 *   brief    -> Opus 4.7
 *   answer   -> Sonnet 4.6 (with optional Opus 4.7 escalation)
 */

export type Provider = "anthropic" | "google" | "openai";

export interface ModelConfig {
  provider: Provider;
  id: string;
  label: string;
  maxOutputTokens: number;
  costPerMtokInput: number;
  costPerMtokOutput: number;
  /** Anthropic cache hits are billed at 10% of input rate; misses at 125%. */
  supportsPromptCaching?: boolean;
}

export const MODELS = {
  opus47: {
    provider: "anthropic",
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    maxOutputTokens: 8192,
    costPerMtokInput: 15,
    costPerMtokOutput: 75,
    supportsPromptCaching: true,
  },
  sonnet46: {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    maxOutputTokens: 8192,
    costPerMtokInput: 3,
    costPerMtokOutput: 15,
    supportsPromptCaching: true,
  },
  haiku45: {
    provider: "anthropic",
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    maxOutputTokens: 4096,
    costPerMtokInput: 1,
    costPerMtokOutput: 5,
    supportsPromptCaching: true,
  },
  gemini25Flash: {
    provider: "google",
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    maxOutputTokens: 8192,
    costPerMtokInput: 0.15,
    costPerMtokOutput: 0.6,
  },
  geminiEmbed: {
    provider: "google",
    id: "gemini-embedding-001",
    label: "Gemini Embedding 001",
    maxOutputTokens: 0,
    costPerMtokInput: 0.15,
    costPerMtokOutput: 0,
  },
} as const satisfies Record<string, ModelConfig>;

export type ModelKey = keyof typeof MODELS;

/**
 * Task taxonomy (Bart's `_classifyMode()` reshaped for COS).
 * Each task type maps to a default model with overrideable selection.
 */
export type Task =
  | "classify_payload"
  | "extract_claims"
  | "resolve_entity"
  | "detect_signals"
  | "answer_question"
  | "generate_briefing"
  | "generate_alert_copy"
  | "verify_facts";

const DEFAULT_TASK_MODEL: Record<Task, ModelKey> = {
  classify_payload: "haiku45",
  extract_claims: "sonnet46",
  resolve_entity: "haiku45",
  detect_signals: "sonnet46",
  answer_question: "sonnet46",
  generate_briefing: "opus47",
  generate_alert_copy: "haiku45",
  verify_facts: "haiku45",
};

export function modelForTask(task: Task, override?: ModelKey): ModelConfig {
  const key = override ?? DEFAULT_TASK_MODEL[task];
  return MODELS[key];
}

/** The model KEY (not config) a task routes to — used by callers of callClaude. */
export function modelKeyForTask(task: Task, override?: ModelKey): ModelKey {
  return override ?? DEFAULT_TASK_MODEL[task];
}
