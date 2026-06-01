#!/usr/bin/env -S npx tsx
/**
 * One-off entity deduplication migration.
 *
 * Background: Codex inferred account names from email domains (e.g., "Chubb")
 * while Salesforce had full legal names (e.g., "Chubb INA Holdings Inc."). The
 * exact-match entity lookup in writeEnvelope() didn't merge these, so the same
 * underlying account appeared in multiple `entities` rows, splitting signals
 * across both.
 *
 * This script:
 *   1. Walks every entity kind
 *   2. Finds groups of entities whose names match per lib/entities/normalize
 *   3. For each group, picks the longest name as canonical
 *   4. Updates FK references on `claims.entity_id` and `signals.entity_id`
 *      from the dupes to the canonical
 *   5. Deletes the now-orphaned dupe rows
 *
 * Idempotent. Safe to re-run.
 *
 * Run with: COS_DATABASE_URL=... npx tsx scripts/db/dedupe-entities.ts
 * (or just rely on the inherited DATABASE_URL env var)
 */

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { namesMatch, pickCanonical } from "@/lib/entities/normalize";

type EntityKind = "account" | "opportunity" | "contact" | "rep" | "initiative" | "competitor";

interface MergePlan {
  canonical: { id: string; name: string };
  dupes: Array<{ id: string; name: string }>;
}

function planMerges(entities: Array<{ id: string; name: string }>): MergePlan[] {
  const merged = new Set<string>();
  const plans: MergePlan[] = [];

  for (let i = 0; i < entities.length; i++) {
    if (merged.has(entities[i].id)) continue;
    const group = [entities[i]];
    for (let j = i + 1; j < entities.length; j++) {
      if (merged.has(entities[j].id)) continue;
      // Match against any name already in the group (handles "A matches B, B matches C, A doesn't match C directly" chains)
      if (group.some((g) => namesMatch(g.name, entities[j].name))) {
        group.push(entities[j]);
        merged.add(entities[j].id);
      }
    }
    if (group.length > 1) {
      const canonicalName = pickCanonical(group.map((e) => e.name));
      const canonical = group.find((e) => e.name === canonicalName)!;
      const dupes = group.filter((e) => e.id !== canonical.id);
      plans.push({ canonical, dupes });
    }
  }
  return plans;
}

async function dedupeKind(kind: EntityKind, dryRun: boolean): Promise<void> {
  const all = await db()
    .select({ id: schema.entities.id, name: schema.entities.name })
    .from(schema.entities)
    .where(eq(schema.entities.kind, kind));

  console.log(`\n=== ${kind} (${all.length} rows) ===`);

  const plans = planMerges(all);
  if (plans.length === 0) {
    console.log("  no duplicates");
    return;
  }

  for (const plan of plans) {
    const dupeIds = plan.dupes.map((d) => d.id);
    console.log(
      `  → "${plan.canonical.name}" merges: ${plan.dupes.map((d) => `"${d.name}"`).join(", ")}`,
    );
    if (dryRun) continue;

    // Update claims to point at canonical
    await db()
      .update(schema.claims)
      .set({ entityId: plan.canonical.id })
      .where(inArray(schema.claims.entityId, dupeIds));

    // Update signals to point at canonical
    await db()
      .update(schema.signals)
      .set({ entityId: plan.canonical.id })
      .where(inArray(schema.signals.entityId, dupeIds));

    // Delete the dupe entity rows
    await db().delete(schema.entities).where(inArray(schema.entities.id, dupeIds));
  }
  console.log(`  merged ${plans.length} groups (${plans.reduce((n, p) => n + p.dupes.length, 0)} dupes removed)`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "DRY RUN — no writes" : "LIVE — writing merges");

  const kinds: EntityKind[] = [
    "account",
    "opportunity",
    "contact",
    "rep",
    "initiative",
    "competitor",
  ];

  for (const kind of kinds) {
    await dedupeKind(kind, dryRun);
  }
  console.log("\nDone.");
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
