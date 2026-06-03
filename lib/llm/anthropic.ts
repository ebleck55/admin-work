/**
 * Anthropic SDK wrapper.
 *
 * Ported from `bart-app/server/lib/orchestrator.js:345-414` (callAnthropic) and
 * `:430-517` (callAnthropicWithTools, max 10-iteration tool-use loop).
 *
 * Differences:
 *   - Uses the official `@anthropic-ai/sdk` instead of raw `https.request` for type safety.
 *   - Adds `cache_control: { type: "ephemeral" }` support on system prompts and tools
 *     (Bart had none — explicit upgrade for COS, per audit row 12).
 *   - Records to the dual cost tracker and respects the per-model circuit breaker.
 */

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlock,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import { env } from "@/lib/env";
import { MODELS, type ModelKey } from "@/lib/llm/router";
import { isCircuitOpen, recordResult } from "@/lib/llm/circuit-breaker";
import { recordGlobalUsage, type CostTracker } from "@/lib/llm/cost-tracker";
import { assertWithinBudget, persistUsage } from "@/lib/llm/budget";

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const opts: ClientOptions = { apiKey: env().ANTHROPIC_API_KEY };
  cachedClient = new Anthropic(opts);
  return cachedClient;
}

export interface ClaudeCallOptions {
  modelKey?: ModelKey;
  system?: string;
  /** When true, mark the system prompt with cache_control:ephemeral. */
  cacheSystem?: boolean;
  messages?: MessageParam[];
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Tool[];
  /** Force the model's tool choice (default is auto). */
  toolChoice?:
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string };
  /** When true, mark tool definitions with cache_control:ephemeral. */
  cacheTools?: boolean;
  costTracker?: CostTracker;
  /** Identifier for audit logging. */
  purpose?: string;
  /**
   * Interactive/user-facing call that should not be hard-blocked by the daily budget cap.
   * Background jobs (briefings, synthesis, research) should leave this false so they pause
   * first when spend approaches the cap.
   */
  essential?: boolean;
  /** Abort signal for upstream cancellation. */
  signal?: AbortSignal;
}

export interface ClaudeCallResult {
  text: string;
  rawContent: Array<TextBlock | ToolUseBlock>;
  stopReason: string | null;
  toolUseCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  modelKey: ModelKey;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

function modelFromKey(key: ModelKey | undefined): { key: ModelKey; id: string; max: number } {
  const resolved = key ?? "sonnet46";
  const cfg = MODELS[resolved];
  return { key: resolved, id: cfg.id, max: cfg.maxOutputTokens };
}

/**
 * One-shot Claude call. No tool-use loop — for that, use `callClaudeWithTools`.
 */
export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const { key, id, max } = modelFromKey(opts.modelKey);
  if (isCircuitOpen(key)) {
    throw new Error(`Anthropic circuit breaker open for ${key}; refusing call.`);
  }
  // Hard daily spend guard (durable, reads llm_usage). Throws BudgetExceededError if over cap.
  await assertWithinBudget({ essential: opts.essential, purpose: opts.purpose });

  const messages: MessageParam[] =
    opts.messages ?? (opts.prompt ? [{ role: "user", content: opts.prompt }] : []);
  if (messages.length === 0) throw new Error("callClaude: messages or prompt required");

  const systemPart =
    opts.system === undefined
      ? undefined
      : opts.cacheSystem
        ? ([{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }] as const)
        : opts.system;

  const tools = opts.tools?.map((t, i) =>
    opts.cacheTools && i === (opts.tools!.length - 1)
      ? ({ ...t, cache_control: { type: "ephemeral" } } as Tool)
      : t,
  );

  const start = Date.now();
  try {
    const response = await client().messages.create(
      {
        model: id,
        max_tokens: opts.maxTokens ?? max,
        temperature: opts.temperature,
        system: systemPart as never,
        messages,
        tools,
        tool_choice: opts.toolChoice as never,
      },
      { signal: opts.signal },
    );
    const durationMs = Date.now() - start;
    recordResult(key, { success: true, durationMs });

    const rawContent = response.content as Array<TextBlock | ToolUseBlock>;
    const textBlocks = rawContent.filter((b): b is TextBlock => b.type === "text");
    const text = textBlocks.map((b) => b.text).join("");
    const toolUseCalls = rawContent
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    const usageRecord = { modelKey: key, ...usage };
    if (opts.costTracker) opts.costTracker.record(usageRecord);
    else recordGlobalUsage(usageRecord);
    persistUsage({
      modelKey: key,
      usage: usageRecord,
      purpose: opts.purpose,
      durationMs,
      success: true,
    });

    return {
      text,
      rawContent,
      stopReason: response.stop_reason,
      toolUseCalls,
      modelKey: key,
      usage,
    };
  } catch (err) {
    recordResult(key, { success: false, durationMs: Date.now() - start });
    persistUsage({
      modelKey: key,
      usage: { modelKey: key, inputTokens: 0, outputTokens: 0 },
      purpose: opts.purpose,
      durationMs: Date.now() - start,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export interface ToolHandler {
  name: string;
  /** Server-side handler. Receives the parsed tool input, returns a string result. */
  execute(input: Record<string, unknown>): Promise<string>;
  /** True for tools Claude executes server-side (e.g. web_search). Skipped locally. */
  serverSide?: boolean;
}

export interface ClaudeToolLoopOptions extends ClaudeCallOptions {
  toolHandlers: Record<string, ToolHandler>;
  /** Max iterations (Bart: 10). */
  maxIterations?: number;
  /** Notifier for tool-use events (SSE forwarding). */
  onToolUse?: (toolName: string, input: Record<string, unknown>) => void;
}

/**
 * Tool-use loop. Ported from `orchestrator.js:430-517 callAnthropicWithTools()`.
 * Max iterations defaults to 10.
 */
export async function callClaudeWithTools(
  opts: ClaudeToolLoopOptions,
): Promise<ClaudeCallResult & { toolsInvoked: Array<{ name: string; input: Record<string, unknown> }> }> {
  const maxIterations = opts.maxIterations ?? 10;
  const messages: MessageParam[] = opts.messages
    ? [...opts.messages]
    : opts.prompt
      ? [{ role: "user", content: opts.prompt }]
      : [];
  if (messages.length === 0) throw new Error("callClaudeWithTools: messages or prompt required");

  const toolsInvoked: Array<{ name: string; input: Record<string, unknown> }> = [];
  let lastResult: ClaudeCallResult | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const result = await callClaude({ ...opts, messages, prompt: undefined });
    lastResult = result;
    if (result.stopReason !== "tool_use" || result.toolUseCalls.length === 0) {
      return { ...result, toolsInvoked };
    }
    messages.push({ role: "assistant", content: result.rawContent });

    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    for (const call of result.toolUseCalls) {
      opts.onToolUse?.(call.name, call.input);
      toolsInvoked.push({ name: call.name, input: call.input });

      const handler = opts.toolHandlers[call.name];
      if (!handler) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `No handler registered for tool ${call.name}`,
          is_error: true,
        });
        continue;
      }
      if (handler.serverSide) continue;
      try {
        const content = await handler.execute(call.input);
        toolResults.push({ type: "tool_result", tool_use_id: call.id, content });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: err instanceof Error ? err.message : String(err),
          is_error: true,
        });
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults as never });
    }
  }

  return {
    ...(lastResult ?? {
      text: "",
      rawContent: [],
      stopReason: null,
      toolUseCalls: [],
      modelKey: modelFromKey(opts.modelKey).key,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    toolsInvoked,
  };
}
