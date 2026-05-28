import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  high: "bg-orange-100 text-orange-900 border-orange-300",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

const KIND_LABEL: Record<string, string> = {
  deal_risk: "Deal risk",
  expansion_opp: "Expansion",
  churn_indicator: "Churn",
  coaching_moment: "Coaching",
  regulatory_signal: "Regulatory",
  competitive_mention: "Competitive",
  commitment: "Commitment",
  escalation: "Escalation",
};

async function loadDashboard() {
  const database = db();

  const signals = await database
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.moduleId, "pipeline"))
    .orderBy(desc(schema.signals.detectedAt))
    .limit(50);

  const opps = await database
    .select({
      id: schema.entities.id,
      name: schema.entities.name,
      externalId: schema.entities.externalId,
      attributes: schema.entities.attributes,
    })
    .from(schema.entities)
    .where(eq(schema.entities.kind, "opportunity"))
    .orderBy(desc(schema.entities.updatedAt))
    .limit(50);

  const counts = await database
    .select({
      severity: schema.signals.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.signals)
    .where(eq(schema.signals.moduleId, "pipeline"))
    .groupBy(schema.signals.severity);

  return { signals, opps, counts };
}

export default async function PipelinePage() {
  let dashboard: Awaited<ReturnType<typeof loadDashboard>>;
  let loadError: string | null = null;
  try {
    dashboard = await loadDashboard();
  } catch (err) {
    dashboard = { signals: [], opps: [], counts: [] };
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
            ← Home
          </Link>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Pipeline</h1>
          <p className="text-slate-600">Deals, risks, commitments, expansion plays.</p>
        </div>
        <div className="flex gap-2">
          {dashboard.counts.map((c) => (
            <span
              key={c.severity}
              className={`rounded-md border px-3 py-1 text-sm ${SEVERITY_STYLE[c.severity] ?? ""}`}
            >
              {c.severity}: {c.count}
            </span>
          ))}
        </div>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load pipeline data:</strong> {loadError}
          <p className="mt-1 text-xs">
            (Most likely the database isn&apos;t reachable. Set <code>DATABASE_URL</code> and run{" "}
            <code>npm run db:push</code>.)
          </p>
        </div>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium text-slate-900">Recent signals</h2>
        {dashboard.signals.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No pipeline signals yet. Drop a Salesforce CSV in{" "}
            <code>~/Desktop/chief of staff app/</code> or POST a payload to{" "}
            <code>/api/ingest</code>.
          </p>
        ) : (
          <ul className="space-y-3">
            {dashboard.signals.map((s) => (
              <li
                key={s.id}
                className={`rounded-md border p-4 ${SEVERITY_STYLE[s.severity] ?? "bg-white"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider opacity-70">
                    {KIND_LABEL[s.kind] ?? s.kind}
                  </div>
                  <div className="text-xs opacity-60">
                    {new Date(s.detectedAt).toLocaleString()}
                  </div>
                </div>
                <div className="mt-1 text-base font-medium">{s.title}</div>
                <div className="mt-1 text-sm opacity-80">{s.summary}</div>
                {s.sensitivity === "private_dm" ? (
                  <div className="mt-2 text-xs italic">
                    private — visible to Eric only, never in shareable artifacts
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-900">Opportunities ({dashboard.opps.length})</h2>
        {dashboard.opps.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No opportunities yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2">Opportunity</th>
                  <th className="px-4 py-2">External ID</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.opps.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-900">{o.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {o.externalId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
