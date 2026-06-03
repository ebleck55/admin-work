import Link from "next/link";
import { gte, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { computeScoreDeltas, rankMovers, label, type ScoreRow } from "@/lib/predictive/deltas";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  churn_likelihood: "bg-red-50 text-red-900 border-red-300",
  expansion_potential: "bg-emerald-50 text-emerald-900 border-emerald-200",
  engagement_health: "bg-amber-50 text-amber-900 border-amber-200",
};

async function loadMovers() {
  const database = db();
  // Look back far enough to capture the latest two weekly snapshots per account.
  const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

  const scoreRows = await database
    .select()
    .from(schema.accountScores)
    .where(gte(schema.accountScores.computedAt, since));

  if (scoreRows.length === 0) return [];

  const accountIds = Array.from(new Set(scoreRows.map((r) => r.accountId)));
  const entRows = await database
    .select({ id: schema.entities.id, name: schema.entities.name })
    .from(schema.entities)
    .where(inArray(schema.entities.id, accountIds));
  const nameById = new Map(entRows.map((e) => [e.id, e.name]));

  const rows: ScoreRow[] = scoreRows.map((r) => ({
    accountId: r.accountId,
    accountName: nameById.get(r.accountId) ?? "(unknown account)",
    kind: r.kind,
    score: r.score,
    computedAt: r.computedAt,
  }));

  return rankMovers(computeScoreDeltas(rows)).slice(0, 25);
}

export default async function MoversPage() {
  let movers: Awaited<ReturnType<typeof loadMovers>> = [];
  let loadError: string | null = null;
  try {
    movers = await loadMovers();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Today
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Movers</h1>
        <p className="text-slate-600">
          Accounts whose health scores moved in the wrong direction week-over-week — ranked by
          the size of the swing. Lead with the biggest changes, not the worst absolute scores.
        </p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      {movers.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No adverse score movement yet. This view needs at least two weekly scoring runs to
          compute deltas — check back after the next run.
        </p>
      ) : (
        <ul className="space-y-3">
          {movers.map((m) => (
            <li
              key={`${m.accountId}-${m.kind}`}
              className={`rounded-md border p-4 ${KIND_STYLE[m.kind] ?? "bg-white"}`}
            >
              <div className="flex items-center justify-between">
                <Link
                  href={`/accounts/${m.accountId}`}
                  className="text-base font-semibold text-slate-900 hover:underline"
                >
                  {m.accountName}
                </Link>
                <div className="flex items-center gap-3 text-xs">
                  <span className="rounded bg-white/70 px-2 py-0.5 font-medium uppercase tracking-wide">
                    {label(m.kind)}
                  </span>
                  <span className="rounded bg-white/70 px-2 py-0.5 font-mono">
                    {m.delta > 0 ? "+" : ""}
                    {m.delta} pts → {m.latest}/100
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm">{m.soWhat}</p>
              <div className="mt-3 flex gap-2 text-xs">
                <Link
                  href={`/chat/from-account/${m.accountId}`}
                  className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
                >
                  Draft the play →
                </Link>
                <Link
                  href={`/accounts/${m.accountId}`}
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
