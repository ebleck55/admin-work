/**
 * Daily cross-source entity resolution. For each entity kind, pulls recently-
 * touched entities + their externally-derived stubs, asks Sonnet 4.6 to
 * identify merge groups, applies the FK updates + deletes.
 *
 * Runs at 4 AM Central daily.
 */

import { db, schema } from "@/lib/db/client";
import { inngest } from "@/inngest/client";
import { resolveCrossSource, applyMerges } from "@/lib/entities/cross-source-resolver";
import { eq } from "drizzle-orm";

const KINDS_TO_RESOLVE: Array<"account" | "opportunity" | "contact"> = [
  "account",
  "opportunity",
];

export const resolveEntities = inngest.createFunction(
  { id: "resolve-entities", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "TZ=America/Chicago 0 4 * * *" }, { event: "entities/resolve.requested" }],
  async ({ step }) => {
    let totalApplied = 0;
    let totalSkipped = 0;

    for (const kind of KINDS_TO_RESOLVE) {
      const candidates = await step.run(`load-${kind}`, async () => {
        const rows = await db()
          .select({
            id: schema.entities.id,
            name: schema.entities.name,
            kind: schema.entities.kind,
            externalId: schema.entities.externalId,
          })
          .from(schema.entities)
          .where(eq(schema.entities.kind, kind))
          .limit(200);
        return rows;
      });

      if (candidates.length < 2) continue;

      const resolved = await step.run(`resolve-${kind}`, async () =>
        resolveCrossSource({ candidates }),
      );

      const result = await step.run(`apply-${kind}`, async () => applyMerges(resolved.merges));
      totalApplied += result.applied;
      totalSkipped += result.skipped;
    }

    return { totalApplied, totalSkipped };
  },
);
