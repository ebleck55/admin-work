import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  high: "bg-orange-100 text-orange-900 border-orange-300",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

async function loadSignal(id: string) {
  const database = db();

  const signalRows = await database
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.id, id))
    .limit(1);
  if (signalRows.length === 0) return null;
  const signal = signalRows[0];

  // Hydrate the linked entity (if any)
  let entity = null as { id: string; name: string; kind: string } | null;
  if (signal.entityId) {
    const rows = await database
      .select({
        id: schema.entities.id,
        name: schema.entities.name,
        kind: schema.entities.kind,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, signal.entityId))
      .limit(1);
    entity = rows[0] ?? null;
  }

  // Pull contributing claims + their evidence quotes + the ledger row each came from
  const claimIds = (signal.claimIds ?? []) as string[];
  const claims =
    claimIds.length === 0
      ? []
      : await database
          .select({
            id: schema.claims.id,
            statement: schema.claims.statement,
            confidence: schema.claims.confidence,
            sensitivity: schema.claims.sensitivity,
            moduleId: schema.claims.moduleId,
            sourceSystem: schema.evidenceLedger.sourceSystem,
            sourceUrl: schema.evidenceLedger.sourceUrl,
            sourceTimestamp: schema.evidenceLedger.sourceTimestamp,
            ledgerId: schema.evidenceLedger.id,
            actor: schema.evidenceLedger.actor,
          })
          .from(schema.claims)
          .leftJoin(schema.evidenceLedger, eq(schema.claims.ledgerId, schema.evidenceLedger.id))
          .where(inArray(schema.claims.id, claimIds));

  const quotes =
    claimIds.length === 0
      ? []
      : await database
          .select()
          .from(schema.evidenceQuotes)
          .where(inArray(schema.evidenceQuotes.claimId, claimIds));

  const quotesByClaim = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const list = quotesByClaim.get(q.claimId) ?? [];
    list.push(q);
    quotesByClaim.set(q.claimId, list);
  }

  return { signal, entity, claims, quotesByClaim };
}

const SOURCE_LABEL: Record<string, string> = {
  outlook_email: "Email",
  outlook_calendar: "Calendar",
  slack: "Slack",
  zoom: "Zoom",
  salesforce: "Salesforce",
  context_note: "Note",
};

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadSignal(id);
  if (!data) notFound();
  const { signal, entity, claims, quotesByClaim } = data;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link
          href={signal.moduleId ? `/${signal.moduleId}` : "/"}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`rounded-md border px-2 py-0.5 text-xs uppercase tracking-wider ${
              SEVERITY_STYLE[signal.severity] ?? ""
            }`}
          >
            {signal.severity}
          </span>
          <span className="text-xs uppercase tracking-wider text-slate-500">
            {signal.moduleId} · {signal.kind}
          </span>
          <span className="text-xs text-slate-400">
            {new Date(signal.detectedAt).toLocaleString()}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{signal.title}</h1>
        <p className="mt-1 text-slate-700">{signal.summary}</p>
        {entity ? (
          <div className="mt-3 text-sm">
            Entity:{" "}
            <Link
              href={entity.kind === "account" ? `/accounts/${entity.id}` : "#"}
              className="text-blue-600 underline"
            >
              {entity.name}
            </Link>{" "}
            <span className="text-slate-400">({entity.kind})</span>
          </div>
        ) : null}
        {signal.sensitivity === "private_dm" ? (
          <div className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs italic text-slate-600">
            private DM — gated from shareable artifacts
          </div>
        ) : null}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-base font-medium text-slate-900">
          Evidence ({claims.length} {claims.length === 1 ? "claim" : "claims"})
        </h2>
        {claims.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            This signal references no claims (legacy or orphaned).
          </p>
        ) : (
          <ol className="space-y-4">
            {claims.map((c, i) => {
              const claimQuotes = quotesByClaim.get(c.id) ?? [];
              return (
                <li
                  key={c.id}
                  className="rounded-md border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono">#{i + 1}</span>
                    <span>
                      {SOURCE_LABEL[c.sourceSystem ?? ""] ?? c.sourceSystem}
                      {c.actor ? ` · ${c.actor}` : ""}
                      {c.sourceTimestamp
                        ? ` · ${new Date(c.sourceTimestamp).toLocaleString()}`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-slate-900">{c.statement}</div>
                  {claimQuotes.length > 0 ? (
                    <ul className="mt-3 space-y-2 border-l-2 border-blue-200 pl-3">
                      {claimQuotes.map((q) => (
                        <li key={q.id} className="text-sm italic text-slate-700">
                          “{q.quote}”
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {c.sourceUrl ? (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-blue-600 underline"
                    >
                      Open source ↗
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {Object.keys(signal.attributes ?? {}).length > 0 ? (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Debug: signal attributes</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs">
{JSON.stringify(signal.attributes, null, 2)}
          </pre>
        </details>
      ) : null}
    </main>
  );
}
