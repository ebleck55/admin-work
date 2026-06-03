/**
 * Phase 14c: per-account external research.
 *
 * Calls Opus 4.7 with Anthropic's hosted web_search tool. Asks for: recent
 * news (last 6 months), funding events (last 2 years), leadership changes,
 * regulatory or compliance mentions. Caller persists the structured result
 * to evidence_ledger so RAG + chat can naturally surface it.
 *
 * Tool-use loop bounded by the existing 10-iteration cap; expected 2-5
 * iterations per call. Cost ~$0.10-0.20 per account.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { callClaudeWithTools } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";
import { WEB_SEARCH_TOOL, webSearchHandler } from "@/lib/llm/tools/web-search";

const CitationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  published_date: z.string().optional(),
  accessed_at: z.string().optional(),
});

const ResearchSchema = z.object({
  summary_md: z.string().min(1),
  recent_news: z
    .array(
      z.object({
        headline: z.string(),
        date: z.string().optional(),
        url: z.string().optional(),
        relevance_to_eric: z.string().optional(),
      }),
    )
    .default([]),
  funding_events: z
    .array(
      z.object({
        round: z.string(),
        amount: z.string().optional(),
        date: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  leadership_changes: z
    .array(
      z.object({
        person: z.string(),
        role: z.string(),
        change_type: z.string(),
        date: z.string().optional(),
      }),
    )
    .default([]),
  regulatory_or_compliance: z
    .array(
      z.object({
        topic: z.string(),
        date: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  citations: z.array(CitationSchema).default([]),
});

export type AccountResearch = z.infer<typeof ResearchSchema>;

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_account_research",
  description:
    "Report the gathered external research about a company. Call once at the end. Stale or low-confidence items: omit rather than include.",
  input_schema: {
    type: "object",
    properties: {
      summary_md: {
        type: "string",
        description:
          "3-6 sentence summary of what's new or material about this company. Markdown ok.",
      },
      recent_news: {
        type: "array",
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD if known" },
            url: { type: "string" },
            relevance_to_eric: {
              type: "string",
              description:
                "Why an SVP of FS GTM at UiPath would care, in one sentence. Skip if unclear.",
            },
          },
          required: ["headline"],
        },
      },
      funding_events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            round: { type: "string" },
            amount: { type: "string" },
            date: { type: "string" },
            notes: { type: "string" },
          },
          required: ["round"],
        },
      },
      leadership_changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            person: { type: "string" },
            role: { type: "string" },
            change_type: {
              type: "string",
              description: "joined | departed | promoted | demoted",
            },
            date: { type: "string" },
          },
          required: ["person", "role", "change_type"],
        },
      },
      regulatory_or_compliance: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            date: { type: "string" },
            notes: { type: "string" },
          },
          required: ["topic"],
        },
      },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            published_date: { type: "string" },
            accessed_at: { type: "string" },
          },
          required: ["url"],
        },
      },
    },
    required: ["summary_md", "citations"],
  },
};

const SYSTEM_EXTRA = `
RESEARCH RULES:
- Use web_search liberally (max 5 calls) to verify each claim.
- Funding amounts older than 24 months: include only if the company hasn't raised since.
- Leadership changes older than 12 months: skip unless they explain a current dynamic.
- News older than 6 months: skip unless directly relevant.
- For every claim in your report, the source must appear in citations.
- Skip rumor, op-ed, and analyst-prediction sources. Prefer primary press, SEC filings, the company's own announcements.
- If you find nothing material, summary_md should say so plainly.
- Call report_account_research exactly once at the end.
`.trim();

export interface ResearchInput {
  accountName: string;
  /** Optional context: what internal signals/situations exist for this account, so
   * external research can be framed to complement them. */
  internalContext?: string;
}

export async function researchAccount(input: ResearchInput): Promise<AccountResearch | null> {
  const prompt = `Research the company "${input.accountName}".

${input.internalContext ? `Internal context (for framing — don't repeat back to me):\n${input.internalContext}\n` : ""}
Gather: recent news (≤ 6 months), funding events (≤ 24 months), leadership changes (≤ 12 months), regulatory or compliance mentions. Use web_search to verify. Then call report_account_research with the structured result.`;

  let result;
  try {
    result = await callClaudeWithTools({
      modelKey: "opus47",
      system: systemPromptFor({
        mode: "extract",
        extra: SYSTEM_EXTRA,
      }),
      cacheSystem: true,
      prompt,
      maxTokens: 6000,
      purpose: "web-research",
      tools: [WEB_SEARCH_TOOL, REPORT_TOOL],
      toolHandlers: {
        web_search: webSearchHandler,
        report_account_research: {
          name: "report_account_research",
          // Local handler returns immediately; the tool input is what we want
          async execute() {
            return "ok";
          },
        },
      },
      maxIterations: 10,
    });
  } catch (err) {
    console.error(
      "[account-research] failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  // Find the final report_account_research tool call (last invocation)
  const reportCall = [...result.toolsInvoked]
    .reverse()
    .find((t) => t.name === "report_account_research");
  if (!reportCall) {
    console.error("[account-research] no report_account_research call");
    return null;
  }

  const parsed = ResearchSchema.safeParse(reportCall.input);
  if (!parsed.success) {
    console.error("[account-research] zod failed:", parsed.error.issues.slice(0, 3));
    return null;
  }

  // Stamp citations with accessed_at = now if missing
  const now = new Date().toISOString();
  return {
    ...parsed.data,
    citations: parsed.data.citations.map((c) => ({ ...c, accessed_at: c.accessed_at ?? now })),
  };
}
