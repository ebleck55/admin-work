import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { globalCostSnapshot } from "@/lib/llm/cost-tracker";

export const dynamic = "force-dynamic";

async function loadStatus() {
  const database = db();
  const counts = await database.execute(sql`
    SELECT
      (SELECT count(*) FROM ${schema.evidenceLedger}) AS ledger_rows,
      (SELECT count(*) FROM ${schema.claims}) AS claim_rows,
      (SELECT count(*) FROM ${schema.signals}) AS signal_rows,
      (SELECT count(*) FROM ${schema.entities}) AS entity_rows,
      (SELECT count(*) FROM ${schema.embeddings}) AS embedding_rows,
      (SELECT count(*) FROM ${schema.briefings}) AS briefing_rows
  `);
  const counts0 = (counts as unknown as Array<Record<string, unknown>>)[0] ?? {};

  const recentUsage = await database
    .select()
    .from(schema.llmUsage)
    .orderBy(desc(schema.llmUsage.createdAt))
    .limit(10);

  return { counts: counts0, recentUsage, snapshot: globalCostSnapshot() };
}

export default async function StatusPage() {
  let data: Awaited<ReturnType<typeof loadStatus>>;
  let loadError: string | null = null;
  try {
    data = await loadStatus();
  } catch (err) {
    data = {
      counts: {},
      recentUsage: [],
      snapshot: { providers: {}, totalCostUsd: 0 },
    };
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Status</h1>
        <p className="text-slate-600">Counts, recent LLM usage, rolling 24h cost.</p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      <section className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Evidence ledger rows", value: data.counts.ledger_rows },
          { label: "Claims", value: data.counts.claim_rows },
          { label: "Signals", value: data.counts.signal_rows },
          { label: "Entities", value: data.counts.entity_rows },
          { label: "Embeddings", value: data.counts.embedding_rows },
          { label: "Briefings", value: data.counts.briefing_rows },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-slate-200 bg-white p-4"
          >
            <div className="text-xs uppercase tracking-wider text-slate-500">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {String(c.value ?? "—")}
            </div>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-slate-900">Rolling 24h LLM cost</h2>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-3xl font-semibold text-slate-900">
            ${data.snapshot.totalCostUsd.toFixed(4)}
          </div>
          {Object.keys(data.snapshot.providers).length === 0 ? (
            <div className="mt-2 text-sm text-slate-500">
              No LLM calls recorded yet in this process.
            </div>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {Object.entries(data.snapshot.providers).map(([k, v]) => (
                <li key={k}>
                  <span className="font-mono">{k}</span>: {v.callCount} calls,
                  ${v.estimatedCostUsd.toFixed(4)} ({v.inputTokens}+{v.outputTokens} tok)
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-900">Recent persisted LLM calls</h2>
        {data.recentUsage.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No persisted LLM usage rows yet (the dual ledger writes only when a call is
            instrumented to record into <code>llm_usage</code>).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-1">When</th>
                <th>Model</th>
                <th>Purpose</th>
                <th>In</th>
                <th>Out</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.recentUsage.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-1 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td className="font-mono text-xs">{u.model}</td>
                  <td>{u.purpose}</td>
                  <td>{u.inputTokens}</td>
                  <td>{u.outputTokens}</td>
                  <td>${u.estimatedCostUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
