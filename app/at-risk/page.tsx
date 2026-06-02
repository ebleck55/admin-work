import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 text-red-900 border-red-300",
  high: "bg-orange-50 text-orange-900 border-orange-300",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

async function loadAtRisk() {
  const database = db();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Pull every signal in the last 7 days whose kind is risk-related
  const riskKinds = ["deal_risk", "churn_indicator", "escalation"];
  const signals = await database
    .select()
    .from(schema.signals)
    .where(
      and(
        inArray(schema.signals.kind, riskKinds as never),
        gte(schema.signals.detectedAt, sevenDaysAgo),
        eq(schema.signals.shareable, true),
      ),
    );

  // Group by entity_id (account)
  const byEntity = new Map<string, { score: number; signals: typeof signals; name: string }>();
  const entityIds = signals.map((s) => s.entityId).filter((id): id is string => !!id);
  const entityMap = new Map<string, string>();
  if (entityIds.length > 0) {
    const entRows = await database
      .select({ id: schema.entities.id, name: schema.entities.name })
      .from(schema.entities)
      .where(inArray(schema.entities.id, entityIds));
    for (const e of entRows) entityMap.set(e.id, e.name);
  }

  for (const s of signals) {
    if (!s.entityId) continue;
    const w = SEVERITY_WEIGHT[s.severity] ?? 1;
    const existing = byEntity.get(s.entityId);
    if (existing) {
      existing.score += w;
      existing.signals.push(s);
    } else {
      byEntity.set(s.entityId, {
        score: w,
        signals: [s],
        name: entityMap.get(s.entityId) ?? "(unknown)",
      });
    }
  }

  // Pull active situations for these accounts
  const accountSituations =
    byEntity.size > 0
      ? await database
          .select()
          .from(schema.situations)
          .where(
            and(
              inArray(schema.situations.entityId, Array.from(byEntity.keys())),
              or(
                eq(schema.situations.status, "open"),
                eq(schema.situations.status, "escalated"),
              ),
              or(
                isNull(schema.situations.snoozedUntil),
                gte(schema.situations.snoozedUntil, new Date()),
              ),
            ),
          )
          .orderBy(desc(schema.situations.updatedAt))
      : [];

  const sitsByEntity = new Map<string, typeof accountSituations>();
  for (const s of accountSituations) {
    if (!s.entityId) continue;
    const list = sitsByEntity.get(s.entityId) ?? [];
    list.push(s);
    sitsByEntity.set(s.entityId, list);
  }

  const ranked = Array.from(byEntity.entries())
    .map(([id, v]) => ({
      entityId: id,
      name: v.name,
      score: v.score,
      signalCount: v.signals.length,
      maxSeverity:
        v.signals.map((s) => s.severity).sort((a, b) => (SEVERITY_WEIGHT[b] ?? 0) - (SEVERITY_WEIGHT[a] ?? 0))[0] ?? "low",
      situations: sitsByEntity.get(id) ?? [],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return ranked;
}

export default async function AtRiskPage() {
  let accounts: Awaited<ReturnType<typeof loadAtRisk>> = [];
  let loadError: string | null = null;
  try {
    accounts = await loadAtRisk();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Today
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">At Risk</h1>
        <p className="text-slate-600">
          Accounts trending negative this week — ranked by combined weight of deal-risk,
          churn-indicator, and escalation signals.
        </p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No risk signals in the last 7 days. Either nothing's at risk, or signals haven't
          synthesized yet — check the home view.
        </p>
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => (
            <li key={a.entityId} className={`rounded-md border p-4 ${SEVERITY_STYLE[a.maxSeverity] ?? "bg-white"}`}>
              <div className="flex items-center justify-between">
                <Link
                  href={`/accounts/${a.entityId}`}
                  className="text-base font-semibold text-slate-900 hover:underline"
                >
                  {a.name}
                </Link>
                <div className="flex items-center gap-3 text-xs">
                  <span className="rounded bg-white/70 px-2 py-0.5 font-mono">
                    risk score {a.score}
                  </span>
                  <span className="opacity-70">{a.signalCount} signal{a.signalCount === 1 ? "" : "s"}</span>
                </div>
              </div>
              {a.situations.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {a.situations.slice(0, 3).map((sit) => (
                    <li key={sit.id}>
                      <Link
                        href={`/situations/${sit.id}`}
                        className="text-sm hover:underline"
                      >
                        → {sit.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs italic opacity-70">
                  No active situation grouping these signals yet.
                </p>
              )}
              <div className="mt-3 flex gap-2 text-xs">
                <Link
                  href={`/chat/from-account/${a.entityId}`}
                  className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
                >
                  Discuss →
                </Link>
                <Link
                  href={`/accounts/${a.entityId}`}
                  className="rounded bg-white/70 px-2 py-1 font-medium text-slate-700 hover:bg-white"
                >
                  Account view →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
