/**
 * Shared module-dashboard scaffold. Renders recent signals for a moduleId,
 * a severity-count bar, and a link to /ask scoped to the module.
 *
 * Per-module pages use this directly; they can extend with module-specific
 * sections (e.g. pipeline shows the opportunity table) by composing around it.
 */

import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { getModule } from "@/lib/modules/registry";
import type { ModuleId } from "@/lib/modules/types";

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

async function loadModuleSignals(moduleId: ModuleId) {
  const database = db();
  const signals = await database
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.moduleId, moduleId))
    .orderBy(desc(schema.signals.detectedAt))
    .limit(50);
  const counts = await database
    .select({
      severity: schema.signals.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.signals)
    .where(eq(schema.signals.moduleId, moduleId))
    .groupBy(schema.signals.severity);
  return { signals, counts };
}

export async function ModuleDashboard({ moduleId }: { moduleId: ModuleId }) {
  const moduleDef = getModule(moduleId);
  if (!moduleDef) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p>Unknown module: {moduleId}</p>
      </main>
    );
  }

  let data: Awaited<ReturnType<typeof loadModuleSignals>>;
  let loadError: string | null = null;
  try {
    data = await loadModuleSignals(moduleId);
  } catch (err) {
    data = { signals: [], counts: [] };
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
            ← Home
          </Link>
          <h1
            className="mt-2 text-3xl font-semibold"
            style={{ color: moduleDef.palette.primary }}
          >
            {moduleDef.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.counts.map((c) => (
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
          <strong>Could not load data:</strong> {loadError}
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-900">Recent signals</h2>
        {data.signals.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No signals yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.signals.map((s) => (
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
                    private — visible to Eric only
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
