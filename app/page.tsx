import Link from "next/link";

const MODULES = [
  { id: "pipeline", title: "Pipeline", href: "/pipeline", live: true },
  { id: "cs", title: "Customer Success", href: "/cs", live: false },
  { id: "team", title: "Team Performance", href: "/team", live: false },
  { id: "initiatives", title: "Strategic Initiatives", href: "/initiatives", live: false },
  { id: "finserv", title: "FinServ Vertical Intel", href: "/finserv", live: false },
  { id: "competitive", title: "Competitive Intel", href: "/competitive", live: false },
  { id: "priorities", title: "Priority Feed", href: "/priorities", live: false },
  { id: "comms", title: "Exec Communications", href: "/comms", live: false },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">Chief of Staff</h1>
        <p className="mt-2 text-slate-600">
          Phase 0 scaffold. Ingestion endpoint live at <code className="font-mono">/api/ingest</code>.
          Dashboards arrive as modules ship.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-medium">Ingest a payload</h2>
        <p className="mt-2 text-sm text-slate-600">
          Send canonical-envelope JSON to <code>/api/ingest</code> with a bearer token. Codex POSTs
          directly; the Mac sync agent does the same after pulling from{" "}
          <code>~/Desktop/chief of staff app/</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
{`curl -X POST $URL/api/ingest \\
  -H "Authorization: Bearer $COS_INGEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d @payload.json`}
        </pre>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {MODULES.map((m) =>
          m.live ? (
            <Link
              key={m.id}
              href={m.href}
              className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-400 hover:shadow-sm"
            >
              <div className="text-sm font-medium uppercase tracking-wider text-blue-700">
                {m.id}
              </div>
              <div className="mt-1 text-lg text-slate-900">{m.title}</div>
              <div className="mt-2 text-xs text-blue-600">Live →</div>
            </Link>
          ) : (
            <div
              key={m.id}
              className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-slate-500"
            >
              <div className="text-sm font-medium uppercase tracking-wider">{m.id}</div>
              <div className="mt-1 text-lg text-slate-800">{m.title}</div>
              <div className="mt-2 text-xs text-slate-400">Module not yet implemented.</div>
            </div>
          ),
        )}
      </section>
    </main>
  );
}
