import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { SituationCard, type SituationCardData } from "@/components/SituationCard";
import { SynthesizeButton } from "@/components/SynthesizeButton";
import { FollowUpRow } from "@/components/FollowUpRow";

export const dynamic = "force-dynamic";

const MODULES = [
  { id: "pipeline", title: "Pipeline", href: "/pipeline" },
  { id: "cs", title: "Customer Success", href: "/cs" },
  { id: "team", title: "Team Performance", href: "/team" },
  { id: "initiatives", title: "Initiatives", href: "/initiatives" },
  { id: "finserv", title: "FinServ", href: "/finserv" },
  { id: "competitive", title: "Competitive", href: "/competitive" },
  { id: "priorities", title: "Priorities", href: "/priorities" },
  { id: "comms", title: "Comms", href: "/comms" },
];

async function loadCuratedSituations(): Promise<SituationCardData[]> {
  const database = db();
  const rows = await database
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
    .where(
      and(
        or(
          eq(schema.situations.status, "open"),
          eq(schema.situations.status, "escalated"),
          eq(schema.situations.status, "watching"),
        ),
        or(
          isNull(schema.situations.snoozedUntil),
          gte(schema.situations.snoozedUntil, new Date()),
        ),
        ne(schema.situations.status, "resolved"),
      ),
    )
    .orderBy(
      // Escalated first, then by severity, then by recency
      sql`case when ${schema.situations.status} = 'escalated' then 0 else 1 end`,
      sql`array_position(ARRAY['critical','high','medium','low']::text[], ${schema.situations.severity}::text)`,
      desc(schema.situations.updatedAt),
    )
    .limit(7);

  const entityIds = rows.map((r) => r.entityId).filter((id): id is string => !!id);
  const entityMap = new Map<string, string>();
  if (entityIds.length > 0) {
    const entRows = await database
      .select({ id: schema.entities.id, name: schema.entities.name })
      .from(schema.entities)
      .where(inArray(schema.entities.id, entityIds));
    for (const e of entRows) entityMap.set(e.id, e.name);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    narrativeMd: r.narrativeMd,
    recommendedAction: r.recommendedAction,
    signalCount: r.signalIds.length,
    entityName: r.entityId ? entityMap.get(r.entityId) ?? null : null,
    entityId: r.entityId,
    hasDecisionFrame: r.decisionFrame !== null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function loadUpcomingMeetings() {
  const database = db();
  return database
    .select()
    .from(schema.calendarEvents)
    .where(gte(schema.calendarEvents.startAt, new Date()))
    .orderBy(asc(schema.calendarEvents.startAt))
    .limit(5);
}

async function loadDueFollowUps() {
  const database = db();
  return database
    .select()
    .from(schema.followUps)
    .where(
      and(
        isNull(schema.followUps.completedAt),
        // due today or earlier
      ),
    )
    .orderBy(asc(schema.followUps.dueAt))
    .limit(10);
}

export default async function Home() {
  let situations: SituationCardData[] = [];
  let meetings: Awaited<ReturnType<typeof loadUpcomingMeetings>> = [];
  let followUps: Awaited<ReturnType<typeof loadDueFollowUps>> = [];
  let loadError: string | null = null;
  try {
    [situations, meetings, followUps] = await Promise.all([
      loadCuratedSituations(),
      loadUpcomingMeetings(),
      loadDueFollowUps(),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wider text-slate-500">{today}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            Today
          </h1>
          <p className="mt-1 text-slate-600">
            The {situations.length} thing{situations.length === 1 ? "" : "s"} I think matter most right now.
          </p>
        </div>
        <SynthesizeButton />
      </header>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      {meetings.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
            Up next
          </h2>
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-slate-200 bg-white p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-900">{m.title}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(m.startAt).toLocaleString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
                {m.prepBriefingMd ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-blue-600">
                      Prep ready ↓
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">
                      {m.prepBriefingMd}
                    </div>
                  </details>
                ) : (
                  <div className="mt-1 text-xs text-slate-400">Prep generates 30 min before start.</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {followUps.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
            Follow-ups due
          </h2>
          <ul className="space-y-1 text-sm">
            {followUps.map((f) => (
              <FollowUpRow
                key={f.id}
                id={f.id}
                title={f.title}
                dueAt={f.dueAt.toISOString()}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
          Open situations
        </h2>
        {situations.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            <p>
              No open situations yet. Once new signals arrive, synthesis will group them into
              situations and surface here.
            </p>
            <p className="mt-2">
              Use <strong>↻ Re-synthesize</strong> to run synthesis manually against current
              signals.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {situations.map((s) => (
              <li key={s.id}>
                <SituationCard situation={s} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8 flex flex-wrap gap-2 text-xs">
        <Link
          href="/chat"
          className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
        >
          Chat with Claude
        </Link>
        <Link
          href="/briefings"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-blue-400"
        >
          Briefings
        </Link>
        <Link
          href="/situations"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-blue-400"
        >
          All situations
        </Link>
        <Link
          href="/at-risk"
          className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 font-medium text-orange-800 hover:bg-orange-100"
        >
          At Risk →
        </Link>
        <Link
          href="/movers"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 font-medium text-red-800 hover:bg-red-100"
        >
          Movers →
        </Link>
        <Link
          href="/accounts"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-blue-400"
        >
          Accounts
        </Link>
        <Link
          href="/notifications"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-blue-400"
        >
          Notifications
        </Link>
        <Link
          href="/status"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-blue-400"
        >
          Status
        </Link>
      </section>

      <details className="mb-8 text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-700">
          Module lenses (browse signals by source-type)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODULES.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-center text-xs text-slate-700 hover:border-blue-400"
            >
              {m.title}
            </Link>
          ))}
        </div>
      </details>
    </main>
  );
}
