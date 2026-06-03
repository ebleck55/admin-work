/**
 * Phase 15a: distill durable preferences from feedback.
 *
 * Each piece of feedback (especially down/not_relevant with a reason) is a
 * data point about Eric's preferences. This function uses Haiku 4.5 to
 * extract a general, embedding-retrievable preference rule from the
 * specific feedback + the target context, and persists it as a memory_fact
 * with kind='preference' so future synthesis runs naturally use it.
 *
 * Triggered by `feedback/inserted` (fired by /api/feedback POST).
 * Concurrency capped to bound LLM cost.
 *
 * Why Haiku not Sonnet/Opus: each call is a small extraction task with one
 * input + a structured output. Haiku is fast + cheap + accurate enough.
 * Cost ~$0.001 per feedback row.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { callClaude } from "@/lib/llm/anthropic";
import { addMemoryFact } from "@/lib/chat/memory";

const PreferenceSchema = z.object({
  durable_preference_text: z.string().min(1).max(400),
  generalizes_beyond_target: z.boolean(),
});

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_inferred_preference",
  description:
    "Report a durable preference distilled from this feedback. Be specific enough to be useful, general enough to apply to future similar cases.",
  input_schema: {
    type: "object",
    properties: {
      durable_preference_text: {
        type: "string",
        description:
          "1-2 sentence statement of the preference. Form: 'Eric prefers/avoids/considers X when Y.' Cite specific entity types, severity ranges, modules, or amount thresholds — NOT specific account names.",
      },
      generalizes_beyond_target: {
        type: "boolean",
        description:
          "True if this preference applies to other entities/situations beyond just the one rejected. False if it's a one-off (e.g., 'don't surface anything about this specific deal').",
      },
    },
    required: ["durable_preference_text", "generalizes_beyond_target"],
  },
};

export const inferPreferenceFromFeedback = inngest.createFunction(
  {
    id: "infer-preference-from-feedback",
    retries: 1,
    concurrency: { limit: 2 },
  },
  { event: "feedback/inserted" },
  async ({ event, step }) => {
    const { feedbackId } = event.data;

    const fbRows = await step.run("load-feedback", async () => {
      return db()
        .select()
        .from(schema.feedback)
        .where(eq(schema.feedback.id, feedbackId))
        .limit(1);
    });
    if (fbRows.length === 0) return { skipped: "feedback_not_found" };
    const fb = fbRows[0];

    // Only generalize from down/not_relevant feedback with a reason
    if (fb.valence === "up" || !fb.reasonCategory) {
      return { skipped: "no_reason_or_positive" };
    }

    const targetCtx = await step.run("load-target-context", async () => {
      if (fb.targetKind === "situation") {
        const sits = await db()
          .select({
            title: schema.situations.title,
            narrative: schema.situations.narrativeMd,
            severity: schema.situations.severity,
          })
          .from(schema.situations)
          .where(eq(schema.situations.id, fb.targetId))
          .limit(1);
        const s = sits[0];
        return s
          ? `SITUATION TITLE: ${s.title}\nSEVERITY: ${s.severity}\nNARRATIVE: ${s.narrative.slice(0, 400)}`
          : `SITUATION (id=${fb.targetId}, no longer in DB)`;
      }
      if (fb.targetKind === "signal") {
        const sigs = await db()
          .select({
            title: schema.signals.title,
            summary: schema.signals.summary,
            kind: schema.signals.kind,
            severity: schema.signals.severity,
            moduleId: schema.signals.moduleId,
          })
          .from(schema.signals)
          .where(eq(schema.signals.id, fb.targetId))
          .limit(1);
        const s = sigs[0];
        return s
          ? `SIGNAL TITLE: ${s.title}\nKIND: ${s.kind}\nSEVERITY: ${s.severity}\nMODULE: ${s.moduleId ?? "n/a"}\nSUMMARY: ${s.summary}`
          : `SIGNAL (id=${fb.targetId}, no longer in DB)`;
      }
      return `TARGET (${fb.targetKind}, id=${fb.targetId})`;
    });

    const userPrompt = `Eric rejected a ${fb.targetKind} with this reason: "${fb.reasonCategory}${fb.reasonText ? ` — ${fb.reasonText.slice(0, 200)}` : ""}".

The ${fb.targetKind} that was rejected:
${targetCtx}

Distill a durable preference rule that will inform future synthesis/briefing for Eric. Call report_inferred_preference exactly once.`;

    const inferred = await step.run("infer-preference", async () => {
      try {
        const result = await callClaude({
          modelKey: "haiku45",
          system: `You are a preference-extraction analyst. Given a single rejection and reason, distill the underlying preference. Be specific about WHAT Eric is rejecting (kind/severity/module/amount-range/source) rather than which specific entity. Avoid encoding specific account or person names — generalize.`,
          prompt: userPrompt,
          maxTokens: 400,
          purpose: "preference-inference",
          tools: [REPORT_TOOL],
          toolChoice: { type: "tool", name: "report_inferred_preference" },
        });
        const toolCall = result.toolUseCalls.find(
          (t) => t.name === "report_inferred_preference",
        );
        if (!toolCall) return null;
        const parsed = PreferenceSchema.safeParse(toolCall.input);
        return parsed.success ? parsed.data : null;
      } catch (err) {
        console.error(
          "[infer-preference] failed:",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    });

    if (!inferred) {
      return { feedbackId, skipped: "inference_failed" };
    }

    // Persist as memory_fact. Lower weight (0.8) than explicit rejections
    // because this is inferred + general; the immediate rejection memory_fact
    // (from /api/feedback) handles the literal "I don't want to see this exact
    // narrative" suppression at weight 1.5.
    const fact = await step.run("persist-memory-fact", async () => {
      return addMemoryFact({
        kind: "preference",
        text: inferred.durable_preference_text,
        weight: inferred.generalizes_beyond_target ? 0.8 : 0.4,
        sensitivity: "internal",
      });
    });

    // Update memory_facts.source_feedback_id (couldn't be set inline via
    // addMemoryFact without adding an arg)
    await step.run("link-feedback", async () => {
      await db()
        .update(schema.memoryFacts)
        .set({ sourceFeedbackId: feedbackId })
        .where(eq(schema.memoryFacts.id, fact.id));
    });

    return {
      feedbackId,
      memoryFactId: fact.id,
      preferenceText: inferred.durable_preference_text,
      generalizes: inferred.generalizes_beyond_target,
    };
  },
);
