import Link from "next/link";
import { desc, gte, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

async function loadPriorities() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const signals = await db()
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.shareable, true))
    .orderBy(desc(schema.signals.detectedAt))
    .limit(200);
  const recent = signals.filter((s) => s.detectedAt >= sevenDaysAgo);
  recent.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 9;
    const sb = SEVERITY_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.detectedAt.getTime() - a.detectedAt.getTime();
  });
  return recent.slice(0, 20);
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  high: "bg-orange-100 text-orange-900 border-orange-300",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

export default async function PrioritiesPage() {
  let signals: Awaited<ReturnType<typeof loadPriorities>> = [];
  let loadError: string | null = null;
  try {
    signals = await loadPriorities();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-amber-700">Priorities</h1>
        <p className="text-slate-600">
          Top 20 ranked signals across all modules, last 7 days. Critical/high first, then
          newest. Skips private_dm.
        </p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load priorities:</strong> {loadError}
        </div>
      ) : null}

      {signals.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No signals in the last 7 days.
        </p>
      ) : (
        <ol className="space-y-3">
          {signals.map((s, i) => (
            <li
              key={s.id}
              className={`rounded-md border p-4 ${SEVERITY_STYLE[s.severity] ?? "bg-white"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs opacity-50">#{i + 1}</span>
                  <span className="text-xs uppercase tracking-wider opacity-70">
                    {s.moduleId} · {s.kind}
                  </span>
                </div>
                <span className="text-xs opacity-60">
                  {new Date(s.detectedAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 text-base font-medium">{s.title}</div>
              <div className="mt-1 text-sm opacity-80">{s.summary}</div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
