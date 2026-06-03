/**
 * Phase 14c: external research on an account, on-demand.
 *
 * Triggered by research/account.requested. Loads the account name + minimal
 * internal context (open situations + most-recent claims), calls
 * researchAccount (Opus 4.7 + web_search tool), persists the result as an
 * evidence_ledger row with source_system='web_research' so the existing RAG
 * + chat surfaces inherit web findings naturally.
 */

import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { researchAccount } from "@/lib/research/account-research";

export const researchAccountFn = inngest.createFunction(
  {
    id: "research-account",
    retries: 1,
    concurrency: { limit: 2 },
    throttle: { limit: 1, period: "30s", key: "event.data.accountId" },
  },
  { event: "research/account.requested" },
  async ({ event, step }) => {
    const { accountId } = event.data;

    const ctx = await step.run("load-context", async () => {
      const accRows = await db()
        .select({ id: schema.entities.id, name: schema.entities.name })
        .from(schema.entities)
        .where(eq(schema.entities.id, accountId))
        .limit(1);
      if (accRows.length === 0) throw new Error(`account ${accountId} not found`);
      const account = accRows[0];

      const sits = await db()
        .select({
          title: schema.situations.title,
          severity: schema.situations.severity,
          narrativeMd: schema.situations.narrativeMd,
        })
        .from(schema.situations)
        .where(eq(schema.situations.entityId, accountId))
        .orderBy(desc(schema.situations.updatedAt))
        .limit(3);

      const claims = await db()
        .select({ statement: schema.claims.statement })
        .from(schema.claims)
        .where(eq(schema.claims.entityId, accountId))
        .orderBy(desc(schema.claims.createdAt))
        .limit(10);

      const internalContext = [
        sits.length > 0
          ? `OPEN SITUATIONS:\n${sits.map((s) => `- [${s.severity}] ${s.title}: ${s.narrativeMd.slice(0, 200)}`).join("\n")}`
          : "",
        claims.length > 0
          ? `RECENT CLAIMS:\n${claims.map((c) => `- ${c.statement}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return { account, internalContext };
    });

    const research = await step.run("run-research", async () =>
      researchAccount({
        accountName: ctx.account.name,
        internalContext: ctx.internalContext || undefined,
      }),
    );

    if (!research) {
      return { accountId, skipped: "research_failed" };
    }

    const sourceId = `research:${accountId}:${new Date().toISOString().slice(0, 10)}`;
    const ledgerId = await step.run("persist-ledger", async () => {
      const inserted = await db()
        .insert(schema.evidenceLedger)
        .values({
          sourceSystem: "web_research",
          sourceId,
          collectedAt: new Date(),
          sourceTimestamp: new Date(),
          actor: null,
          sensitivity: "internal",
          confidence: 0.8,
          rawPayload: {
            account_id: accountId,
            account_name: ctx.account.name,
            research,
          },
          processedAt: new Date(),
        })
        .returning({ id: schema.evidenceLedger.id })
        .catch(async (err) => {
          // Idempotency: if the (sourceSystem, sourceId) unique pair already
          // exists for today, return the existing row instead of failing.
          const existing = await db()
            .select({ id: schema.evidenceLedger.id })
            .from(schema.evidenceLedger)
            .where(eq(schema.evidenceLedger.sourceId, sourceId))
            .limit(1);
          if (existing[0]) return existing;
          throw err;
        });
      return inserted[0].id;
    });

    return {
      accountId,
      accountName: ctx.account.name,
      ledgerId,
      newsCount: research.recent_news.length,
      fundingCount: research.funding_events.length,
      leadershipCount: research.leadership_changes.length,
      regulatoryCount: research.regulatory_or_compliance.length,
      citationCount: research.citations.length,
    };
  },
);
