import Link from "next/link";
import { desc } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { getOrTriggerBriefing } from "@/lib/preload";

export const dynamic = "force-dynamic";

async function load() {
  // Trigger today's daily briefing if missing, then list recent
  const today = await getOrTriggerBriefing({});
  const recent = await db()
    .select()
    .from(schema.briefings)
    .orderBy(desc(schema.briefings.forDate), desc(schema.briefings.generatedAt))
    .limit(30);
  return { today, recent };
}

export default async function BriefingsPage() {
  let data: Awaited<ReturnType<typeof load>>;
  let loadError: string | null = null;
  try {
    data = await load();
  } catch (err) {
    data = {
      today: { briefing: null, triggered: false },
      recent: [],
    };
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Briefings</h1>
        <p className="text-slate-600">
          Morning briefings preload via Vercel Cron at 6am EST. Open before preload runs and we
          generate on demand.
        </p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load briefings:</strong> {loadError}
        </div>
      ) : null}

      <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-medium">Today</h2>
        {data.today.briefing ? (
          <div className="mt-3 space-y-3">
            <div className="text-sm text-slate-500">
              Status: <span className="font-medium">{data.today.briefing.status}</span>
            </div>
            {data.today.briefing.audioUrl ? (
              <audio controls src={data.today.briefing.audioUrl} className="w-full" />
            ) : null}
            <article className="prose prose-slate prose-sm max-w-none whitespace-pre-wrap text-slate-900">
              {data.today.briefing.contentMd ?? "(Generating…)"}
            </article>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            {data.today.triggered
              ? "Generation requested. Refresh in 30-60 seconds."
              : "No briefing for today yet."}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-900">Archive</h2>
        {data.recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No briefings yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.recent.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">{b.title}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(b.forDate).toLocaleDateString()} · {b.status}
                  </div>
                </div>
                {b.audioUrl ? (
                  <audio controls src={b.audioUrl} className="h-8 w-64" />
                ) : (
                  <span className="text-xs text-slate-400">audio pending</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
