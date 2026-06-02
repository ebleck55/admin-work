import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

async function load() {
  const versions = await db()
    .select()
    .from(schema.graderPromptVersions)
    .orderBy(desc(schema.graderPromptVersions.createdAt))
    .limit(20);

  const recentFeedback = await db()
    .select()
    .from(schema.feedback)
    .orderBy(desc(schema.feedback.createdAt))
    .limit(30);

  return { versions, recentFeedback };
}

export default async function AdminGraderPage() {
  let versions: Awaited<ReturnType<typeof load>>["versions"] = [];
  let recentFeedback: Awaited<ReturnType<typeof load>>["recentFeedback"] = [];
  let loadError: string | null = null;
  try {
    const data = await load();
    versions = data.versions;
    recentFeedback = data.recentFeedback;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Grader prompt versions</h1>
      <p className="mt-1 text-sm text-slate-600">
        The signal grader reads its system-prompt extras from this table. To activate a new
        version, manually set <code>active=true</code> for one row and <code>false</code>{" "}
        for the rest (UI form coming later). The grader caches the active prompt for 60s.
      </p>

      {loadError ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {loadError}
        </div>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
          Versions
        </h2>
        {versions.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No DB-stored grader prompts yet. The fallback constant in
            <code> lib/signals/grader.ts</code> is in use. Insert a row with{" "}
            <code>active=true</code> to override.
          </p>
        ) : (
          <ul className="space-y-3">
            {versions.map((v) => (
              <li
                key={v.id}
                className={`rounded-md border p-4 ${v.active ? "border-green-300 bg-green-50" : "border-slate-200 bg-white"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{v.name}</span>
                  <span className="text-xs text-slate-500">
                    {v.active ? "ACTIVE · " : ""}
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {v.notes ? <p className="mt-1 text-xs text-slate-600">{v.notes}</p> : null}
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-500">View prompt</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono">
                    {v.promptText}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
          Recent feedback (last 30)
        </h2>
        {recentFeedback.length === 0 ? (
          <p className="text-sm text-slate-500">No feedback yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {recentFeedback.map((f) => (
              <li key={f.id} className="rounded border border-slate-200 bg-white px-2 py-1">
                <span className="font-mono">{new Date(f.createdAt).toLocaleString()}</span> ·{" "}
                {f.valence} · {f.targetKind}/{f.targetId.slice(0, 8)} ·{" "}
                {f.reasonCategory ?? f.reasonText ?? "(no reason)"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
