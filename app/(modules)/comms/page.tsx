import Link from "next/link";
import { desc } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

async function loadDrafts() {
  // Phase 5+: this page lists generated artifacts (board prep, talking points, async drafts).
  // For now, it lists recent shareable briefings so Eric has a single place to grab them.
  const recent = await db()
    .select()
    .from(schema.briefings)
    .orderBy(desc(schema.briefings.generatedAt))
    .limit(15);
  return recent;
}

export default async function CommsPage() {
  let briefings: Awaited<ReturnType<typeof loadDrafts>> = [];
  let loadError: string | null = null;
  try {
    briefings = await loadDrafts();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-800">Exec Communications</h1>
        <p className="text-slate-600">
          Recent briefings available for board prep, async comms, and talking-points
          repurposing. Per-artifact generation lands in a later phase.
        </p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      {briefings.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No briefings generated yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {briefings.map((b) => (
            <li key={b.id} className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-900">{b.title}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(b.forDate).toLocaleDateString()} · {b.status}
                  </div>
                </div>
                {b.audioUrl ? <audio controls src={b.audioUrl} className="h-8 w-64" /> : null}
              </div>
              {b.contentMd ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-500">View briefing</summary>
                  <article className="prose prose-slate prose-sm mt-2 max-w-none whitespace-pre-wrap text-slate-900">
                    {b.contentMd}
                  </article>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
