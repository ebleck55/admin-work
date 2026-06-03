/**
 * Phase 14c: Anthropic's hosted web_search tool.
 *
 * `web_search_20250305` is a server-side tool — Anthropic executes the search,
 * returns results inline as ToolUseBlock + automatically threaded citations.
 * No local execution needed.
 *
 * We declare the tool definition and a `ToolHandler` with `serverSide: true`
 * so the existing tool-use loop at lib/llm/anthropic.ts:callClaudeWithTools
 * correctly skips local execution (line ~216).
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ToolHandler } from "@/lib/llm/anthropic";

export const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
} as unknown as Anthropic.Tool;

export const webSearchHandler: ToolHandler = {
  name: "web_search",
  serverSide: true,
  // serverSide handlers are not invoked locally; execute() is unused but
  // required by the interface
  async execute() {
    return "web_search is server-side; the SDK should not have asked us to execute it.";
  },
};
