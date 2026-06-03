import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { SituationCard, type SituationCardData } from "@/components/SituationCard";
import { MergeSituationsControl } from "@/components/MergeSituationsControl";

export const dynamic = "force-dynamic";

interface SearchParams {
  status?: string;
  severity?: string;
}

async function loadSituations(params: SearchParams) {
  const conds = [];

  // Hide snoozed-still-quiet rows
  conds.push(
    or(
      isNull(schema.situations.snoozedUntil),
      gte(schema.situations.snoozedUntil, new Date()),
    ),
  );

  const validStatuses = ["open", "watching", "escalated", "resolved", "snoozed"];
  const statusFilter = params.status && validStatuses.includes(params.status)
    ? params.status
    : null;
  if (statusFilter) {
    conds.push(eq(schema.situations.status, statusFilter as never));
  } else {
    // Default: hide resolved
    conds.push(ne(schema.situations.status, "resolved"));
  }

  const validSev = ["low", "medium", "high", "critical"];
  if (params.severity && validSev.includes(params.severity)) {
    conds.push(eq(schema.situations.severity, params.severity as never));
  }

  const rows = await db()
    .select({
      id: schema.situations.id,
      title: schema.situations.title,
      narrativeMd: schema.situations.narrativeMd,
      recommendedAction: schema.situations.recommendedAction,
      status: schema.situations.status,
      severity: schema.situations.severity,
      entityId: schema.situations.entityId,
      signalIds: schema.situations.signalIds,
      decisionFrame: schema.situations.decisionFrame,
      updatedAt: schema.situations.updatedAt,
    })
    .from(schema.situations)
    .where(and(...conds))
    .orderBy(
      sql`array_position(ARRAY['critical','high','medium','low']::text[], ${schema.situations.severity}::text)`,
      desc(schema.situations.updatedAt),
    )
    .limit(50);

  const entityIds = rows.map((r) => r.entityId).filter((id): id is string => !!id);
  const entityMap = new Map<string, { id: string; name: string }>();
  if (entityIds.length > 0) {
    const entRows = await db()
      .select({ id: schema.entities.id, name: schema.entities.name })
      .from(schema.entities)
      .where(inArray(schema.entities.id, entityIds));
    for (const e of entRows) entityMap.set(e.id, e);
  }

  return rows.map<SituationCardData>((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    narrativeMd: r.narrativeMd,
    recommendedAction: r.recommendedAction,
    signalCount: r.signalIds.length,
    entityName: r.entityId ? entityMap.get(r.entityId)?.name ?? null : null,
    entityId: r.entityId,
    hasDecisionFrame: r.decisionFrame !== null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export default async function SituationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  let situations: SituationCardData[] = [];
  let loadError: string | null = null;
  try {
    situations = await loadSituations(params);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Situations</h1>
        <p className="text-slate-600">
          Narrative threads grouping related signals. Use the home view for the curated top
          set — this page is the full browseable list.
        </p>
      </div>

      {situations.length > 1 ? (
        <div className="mb-4">
          <MergeSituationsControl
            candidates={situations.map((s) => ({ id: s.id, title: s.title }))}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {[
          { key: "all", label: "All open" },
          { key: "escalated", label: "Escalated" },
          { key: "watching", label: "Watching" },
          { key: "snoozed", label: "Snoozed" },
          { key: "resolved", label: "Resolved" },
        ].map((f) => {
          const active =
            (f.key === "all" && !params.status) || params.status === f.key;
          const href = f.key === "all" ? "/situations" : `/situations?status=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={`rounded px-3 py-1 ${
                active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      {situations.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No situations match this filter. As new signals arrive and synthesis runs, situations
          will populate here.
        </p>
      ) : (
        <ul className="space-y-3">
          {situations.map((s) => (
            <li key={s.id}>
              <SituationCard situation={s} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
