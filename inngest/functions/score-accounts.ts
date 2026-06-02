/**
 * Weekly account-health scoring. Iterates accounts with recent activity,
 * loads context, calls scoreAccount, persists per-kind scores into
 * account_scores.
 *
 * Schedule: Mondays 5 AM Central. Concurrency=2 to bound Opus rate.
 *
 * Also listens on `scoring/account.requested` { accountId } for on-demand
 * single-account refresh.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { scoreAccount } from "@/lib/predictive/scorer";

const ACTIVITY_WINDOW_DAYS = 60;

async function loadContextForAccount(accountId: string) {
  const database = db();
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const accRows = await database
    .select({ id: schema.entities.id, name: schema.entities.name })
    .from(schema.entities)
    .where(eq(schema.entities.id, accountId))
    .limit(1);
  if (accRows.length === 0) return null;

  const claims = await database
    .select({
      statement: schema.claims.statement,
      sourceSystem: schema.evidenceLedger.sourceSystem,
      sourceTimestamp: schema.evidenceLedger.sourceTimestamp,
    })
    .from(schema.claims)
    .leftJoin(
      schema.evidenceLedger,
      eq(schema.claims.ledgerId, schema.evidenceLedger.id),
    )
    .where(
      and(
        eq(schema.claims.entityId, accountId),
        gte(schema.evidenceLedger.sourceTimestamp, since),
      ),
    )
    .orderBy(desc(schema.evidenceLedger.sourceTimestamp))
    .limit(30);

  const sits = await database
    .select({
      title: schema.situations.title,
      severity: schema.situations.severity,
      narrativeMd: schema.situations.narrativeMd,
    })
    .from(schema.situations)
    .where(eq(schema.situations.entityId, accountId))
    .orderBy(desc(schema.situations.updatedAt))
    .limit(5);

  // Open opportunities = entities of kind 'opportunity' that share recent claims with this account
  // Approximation: pull opportunity entities whose name contains the account name as a prefix
  const opps = await database
    .select({
      name: schema.entities.name,
      attributes: schema.entities.attributes,
    })
    .from(schema.entities)
    .where(eq(schema.entities.kind, "opportunity"))
    .limit(200);
  const relatedOpps = opps.filter((o) =>
    o.name.toLowerCase().includes(accRows[0].name.toLowerCase().split(" ")[0]),
  );

  return {
    name: accRows[0].name,
    recentClaims: claims.map((c) => ({
      statement: c.statement,
      sourceSystem: c.sourceSystem ?? "unknown",
      sourceTimestamp:
        typeof c.sourceTimestamp === "string"
          ? c.sourceTimestamp
          : c.sourceTimestamp?.toISOString() ?? "",
    })),
    openSituations: sits,
    openOpportunities: relatedOpps.slice(0, 10).map((o) => ({
      name: o.name,
      stage: ((o.attributes as Record<string, unknown>)?.stage as string) ?? undefined,
      amount: ((o.attributes as Record<string, unknown>)?.amount as number) ?? undefined,
    })),
  };
}

async function scoreAndPersist(accountId: string): Promise<{ scored: boolean }> {
  const ctx = await loadContextForAccount(accountId);
  if (!ctx) return { scored: false };
  const scores = await scoreAccount({
    accountName: ctx.name,
    recentClaims: ctx.recentClaims,
    openSituations: ctx.openSituations,
    openOpportunities: ctx.openOpportunities,
  });
  if (!scores) return { scored: false };

  const inserts = [
    {
      accountId,
      kind: "churn_likelihood" as const,
      score: scores.churn_likelihood.score,
      reasoningMd: scores.churn_likelihood.reasoning,
    },
    {
      accountId,
      kind: "expansion_potential" as const,
      score: scores.expansion_potential.score,
      reasoningMd: scores.expansion_potential.reasoning,
    },
    {
      accountId,
      kind: "engagement_health" as const,
      score: scores.engagement_health.score,
      reasoningMd: scores.engagement_health.reasoning,
    },
  ];
  await db().insert(schema.accountScores).values(inserts);
  return { scored: true };
}

export const scoreAccountsWeekly = inngest.createFunction(
  {
    id: "score-accounts-weekly",
    retries: 1,
    concurrency: { limit: 2 },
  },
  [
    { cron: "TZ=America/Chicago 0 5 * * 1" },
    { event: "scoring/account.requested" },
  ],
  async ({ event, step }) => {
    // On-demand: single account specified
    const specificId = (event.data as { accountId?: string } | undefined)?.accountId;
    if (specificId) {
      const r = await step.run(`score-${specificId}`, async () => scoreAndPersist(specificId));
      return { mode: "single", scored: r.scored ? 1 : 0 };
    }

    // Weekly: pick accounts with activity in the last 60 days
    const activeAccountIds = await step.run("find-active-accounts", async () => {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const rows = await db()
        .select({ entityId: schema.claims.entityId })
        .from(schema.claims)
        .leftJoin(
          schema.evidenceLedger,
          eq(schema.claims.ledgerId, schema.evidenceLedger.id),
        )
        .where(gte(schema.evidenceLedger.sourceTimestamp, since));
      const ids = new Set<string>();
      for (const r of rows) if (r.entityId) ids.add(r.entityId);
      if (ids.size === 0) return [];

      // Restrict to account-kind entities
      const accs = await db()
        .select({ id: schema.entities.id })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.kind, "account"),
            inArray(schema.entities.id, Array.from(ids)),
          ),
        );
      return accs.map((a) => a.id);
    });

    let scoredCount = 0;
    for (const id of activeAccountIds) {
      const r = await step.run(`score-${id}`, async () => scoreAndPersist(id));
      if (r.scored) scoredCount += 1;
    }
    return { mode: "weekly", accountsConsidered: activeAccountIds.length, scoredCount };
  },
);
