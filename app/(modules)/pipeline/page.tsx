import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import {
  loadModuleSignals,
  type SignalFilterParams,
} from "@/components/ModuleDashboard";
import { SignalFilters } from "@/components/SignalFilters";

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
  commitment: "Commitment",
};

async function loadOpps() {
  return db()
    .select({
      id: schema.entities.id,
      name: schema.entities.name,
      externalId: schema.entities.externalId,
    })
    .from(schema.entities)
    .where(eq(schema.entities.kind, "opportunity"))
    .orderBy(desc(schema.entities.updatedAt))
    .limit(50);
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<SignalFilterParams>;
}) {
  const filters = await searchParams;
  let signals: Awaited<ReturnType<typeof loadModuleSignals>>["signals"] = [];
  let counts: Awaited<ReturnType<typeof loadModuleSignals>>["counts"] = [];
  let opps: Awaited<ReturnType<typeof loadOpps>> = [];
  let loadError: string | null = null;
  try {
    const result = await loadModuleSignals("pipeline", filters);
    signals = result.signals;
    counts = result.counts;
    opps = await loadOpps();
  } catch (err) {
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
          {counts.map((c) => (
            <span
              key={c.severity}
              className={`rounded-md border px-3 py-1 text-sm ${SEVERITY_STYLE[c.severity] ?? ""}`}
            >
              {c.severity}: {c.count}
            </span>
          ))}
        </div>
      </div>

      <SignalFilters />

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load pipeline data:</strong> {loadError}
        </div>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium text-slate-900">
          {signals.length} signal{signals.length === 1 ? "" : "s"}
        </h2>
        {signals.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No pipeline signals match this filter.
          </p>
        ) : (
          <ul className="space-y-3">
            {signals.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/signals/${s.id}`}
                  className={`block rounded-md border p-4 hover:shadow-sm ${SEVERITY_STYLE[s.severity] ?? "bg-white"}`}
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
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-900">
          Opportunities ({opps.length})
        </h2>
        {opps.length === 0 ? (
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
                {opps.map((o) => (
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
