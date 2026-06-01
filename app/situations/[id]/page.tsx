import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 border-red-300 text-red-900",
  high: "bg-orange-50 border-orange-300 text-orange-900",
  medium: "bg-amber-50 border-amber-200 text-amber-900",
  low: "bg-slate-50 border-slate-200 text-slate-700",
};

async function loadSituation(id: string) {
  const database = db();
  const rows = await database
    .select()
    .from(schema.situations)
    .where(eq(schema.situations.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const situation = rows[0];

  let entity = null as { id: string; name: string; kind: string } | null;
  if (situation.entityId) {
    const er = await database
      .select({
        id: schema.entities.id,
        name: schema.entities.name,
        kind: schema.entities.kind,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, situation.entityId))
      .limit(1);
    entity = er[0] ?? null;
  }

  const sigIds = situation.signalIds as string[];
  const signals =
    sigIds.length > 0
      ? await database
          .select()
          .from(schema.signals)
          .where(inArray(schema.signals.id, sigIds))
      : [];

  const actions = await database
    .select()
    .from(schema.situationActions)
    .where(eq(schema.situationActions.situationId, id))
    .orderBy(desc(schema.situationActions.createdAt))
    .limit(20);

  return { situation, entity, signals, actions };
}

export default async function SituationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadSituation(id);
  if (!data) notFound();
  const { situation, entity, signals, actions } = data;
  const decisionFrame = situation.decisionFrame;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link href="/situations" className="text-sm text-slate-500 hover:text-slate-700">
          ← Situations
        </Link>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span
            className={`rounded-full border px-2 py-0.5 uppercase tracking-wider ${SEVERITY_STYLE[situation.severity] ?? ""}`}
          >
            {situation.severity}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase tracking-wider text-slate-700">
            {situation.status}
          </span>
          {entity ? (
            <Link
              href={`/accounts/${entity.id}`}
              className="text-slate-600 underline hover:text-slate-900"
            >
              {entity.name}
            </Link>
          ) : null}
          <span className="text-slate-400">
            Updated {new Date(situation.updatedAt).toLocaleString()}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{situation.title}</h1>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
          Narrative
        </h2>
        <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900">
          {situation.narrativeMd}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
          Why it matters
        </h2>
        <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          {situation.reasoningMd}
        </div>
      </section>

      {situation.recommendedAction ? (
        <section className="mb-8 rounded-md border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-blue-700">
            Recommended next step
          </h2>
          <p className="text-sm text-blue-900">{situation.recommendedAction}</p>
        </section>
      ) : null}

      {decisionFrame ? (
        <section className="mb-8 rounded-md border border-purple-200 bg-purple-50 p-4">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-purple-700">
            Decision frame
          </h2>
          <p className="text-sm font-medium text-purple-900">{decisionFrame.question}</p>
          <ul className="mt-3 space-y-2">
            {decisionFrame.options.map((opt, i) => (
              <li key={i} className="rounded bg-white/70 p-2 text-sm">
                <div className="font-medium text-purple-900">{opt.label}</div>
                <div className="text-purple-800">{opt.tradeoff}</div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-purple-900">
            <strong>Recommendation:</strong> {decisionFrame.recommendation}
          </p>
          <p className="mt-1 text-xs text-purple-700">{decisionFrame.reasoning}</p>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
          {signals.length} contributing signal{signals.length === 1 ? "" : "s"}
        </h2>
        {signals.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No signals attached (legacy or orphaned situation).
          </p>
        ) : (
          <ul className="space-y-2">
            {signals.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/signals/${s.id}`}
                  className="block rounded border border-slate-200 bg-white p-3 hover:border-blue-400"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="uppercase tracking-wider text-slate-500">
                      {s.moduleId} · {s.kind} · {s.severity}
                    </span>
                    <span className="text-slate-400">
                      {new Date(s.detectedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{s.title}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {actions.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
            Action history
          </h2>
          <ul className="space-y-1 text-xs text-slate-600">
            {actions.map((a) => (
              <li key={a.id}>
                <span className="font-mono">{new Date(a.createdAt).toLocaleString()}</span> ·{" "}
                {a.kind}
                {Object.keys(a.payload).length > 0
                  ? ` · ${JSON.stringify(a.payload)}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
