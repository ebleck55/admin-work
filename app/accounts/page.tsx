import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

async function loadAccounts() {
  const database = db();

  const rows = await database
    .select({
      id: schema.entities.id,
      name: schema.entities.name,
      externalId: schema.entities.externalId,
      signalCount: sql<number>`count(distinct ${schema.signals.id})::int`,
      criticalCount: sql<number>`count(distinct ${schema.signals.id}) filter (where ${schema.signals.severity} in ('critical','high'))::int`,
      latestSignal: sql<Date | null>`max(${schema.signals.detectedAt})`,
    })
    .from(schema.entities)
    .leftJoin(schema.signals, eq(schema.signals.entityId, schema.entities.id))
    .where(eq(schema.entities.kind, "account"))
    .groupBy(schema.entities.id, schema.entities.name, schema.entities.externalId)
    .orderBy(desc(sql`max(${schema.signals.detectedAt})`), schema.entities.name);

  return rows;
}

export default async function AccountsPage() {
  let accounts: Awaited<ReturnType<typeof loadAccounts>> = [];
  let loadError: string | null = null;
  try {
    accounts = await loadAccounts();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const withActivity = accounts.filter((a) => a.signalCount > 0);
  const quiet = accounts.filter((a) => a.signalCount === 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Accounts</h1>
        <p className="text-slate-600">
          {accounts.length} accounts. {withActivity.length} with recent signal activity.
        </p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium text-slate-900">With signals</h2>
        {withActivity.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No accounts have signals yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {withActivity.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/accounts/${a.id}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 hover:border-blue-400 hover:shadow-sm"
                >
                  <div>
                    <div className="font-medium text-slate-900">{a.name}</div>
                    {a.externalId ? (
                      <div className="font-mono text-xs text-slate-400">{a.externalId}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {a.criticalCount > 0 ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-800">
                        {a.criticalCount} critical/high
                      </span>
                    ) : null}
                    <span className="text-slate-500">{a.signalCount} signals</span>
                    {a.latestSignal ? (
                      <span className="text-slate-400">
                        {new Date(a.latestSignal).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <details>
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
            {quiet.length} quiet accounts (no signal activity yet)
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-1 text-sm">
            {quiet.slice(0, 100).map((a) => (
              <li key={a.id}>
                <Link
                  href={`/accounts/${a.id}`}
                  className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
                >
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
          {quiet.length > 100 ? (
            <p className="mt-2 text-xs text-slate-400">… and {quiet.length - 100} more</p>
          ) : null}
        </details>
      </section>
    </main>
  );
}
