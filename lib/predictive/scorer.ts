/**
 * LLM-scored account health metrics (churn likelihood, expansion potential,
 * engagement health). Run weekly per account via Inngest. Opus 4.7 reads recent
 * claims + situations + open opportunities and returns a 0-100 score with
 * structured reasoning via tool-use.
 *
 * NOT a true ML model — this is reasoning-grade LLM scoring. Strengths:
 * transparent reasoning, fast to build, easy to tune via the same feedback
 * mechanism Phase 10 introduced. Weaknesses: less calibrated than learned
 * scoring, costs ~$0.10/account/week. For 300 accounts that's ~$120/month.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { callClaude } from "@/lib/llm/anthropic";
import { systemPromptFor } from "@/lib/prompts/system";

const ScoresSchema = z.object({
  churn_likelihood: z.object({
    score: z.number().int().min(0).max(100),
    reasoning: z.string().min(1),
  }),
  expansion_potential: z.object({
    score: z.number().int().min(0).max(100),
    reasoning: z.string().min(1),
  }),
  engagement_health: z.object({
    score: z.number().int().min(0).max(100),
    reasoning: z.string().min(1),
  }),
});

export type AccountScores = z.infer<typeof ScoresSchema>;

const SCORE_TOOL: Anthropic.Tool = {
  name: "report_account_scores",
  description:
    "Score an account on three dimensions: churn likelihood (higher = more likely to leave), expansion potential (higher = more likely to grow), engagement health (higher = healthier).",
  input_schema: {
    type: "object",
    properties: {
      churn_likelihood: {
        type: "object",
        properties: {
          score: {
            type: "integer",
            description: "0 = retaining strongly, 100 = imminent loss",
          },
          reasoning: { type: "string", description: "2-3 sentences. Reference specific signals." },
        },
        required: ["score", "reasoning"],
      },
      expansion_potential: {
        type: "object",
        properties: {
          score: { type: "integer", description: "0 = no upside visible, 100 = strong expansion signal" },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      engagement_health: {
        type: "object",
        properties: {
          score: { type: "integer", description: "0 = ghost / silent, 100 = highly engaged" },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
    },
    required: ["churn_likelihood", "expansion_potential", "engagement_health"],
  },
};

export interface AccountScoreInput {
  accountName: string;
  recentClaims: Array<{ statement: string; sourceSystem: string; sourceTimestamp: string }>;
  openSituations: Array<{
    title: string;
    severity: string;
    narrativeMd: string;
  }>;
  openOpportunities: Array<{ name: string; stage?: string; amount?: number }>;
}

export async function scoreAccount(input: AccountScoreInput): Promise<AccountScores | null> {
  if (
    input.recentClaims.length === 0 &&
    input.openSituations.length === 0 &&
    input.openOpportunities.length === 0
  ) {
    return null;
  }

  const prompt = `Account: ${input.accountName}

OPEN SITUATIONS:
${input.openSituations.map((s) => `- [${s.severity}] ${s.title}: ${s.narrativeMd.slice(0, 200)}`).join("\n") || "(none)"}

OPEN OPPORTUNITIES:
${input.openOpportunities.map((o) => `- ${o.name}${o.stage ? ` [${o.stage}]` : ""}${o.amount ? ` $${o.amount.toLocaleString()}` : ""}`).join("\n") || "(none)"}

RECENT CLAIMS (last 60 days):
${input.recentClaims.map((c) => `- [${c.sourceSystem}] ${c.statement}`).join("\n") || "(none)"}

Score this account on three dimensions and explain your reasoning for each.`;

  let result;
  try {
    result = await callClaude({
      modelKey: "opus47",
      system: systemPromptFor({
        mode: "verify",
        extra:
          "You're scoring account health for an SVP. Be opinionated but defensible — cite specific signals when reasoning. Suppress generic statements.",
      }),
      cacheSystem: true,
      prompt,
      maxTokens: 1500,
      purpose: "account-scorer",
      tools: [SCORE_TOOL],
      toolChoice: { type: "tool", name: "report_account_scores" },
    });
  } catch (err) {
    console.error("[scorer] failed:", err instanceof Error ? err.message : err);
    return null;
  }

  const toolCall = result.toolUseCalls.find((t) => t.name === "report_account_scores");
  if (!toolCall) return null;
  const parsed = ScoresSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    console.error("[scorer] zod failed:", parsed.error.issues.slice(0, 3));
    return null;
  }
  return parsed.data;
}
