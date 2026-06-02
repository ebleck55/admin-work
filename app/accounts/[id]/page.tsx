import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  high: "bg-orange-100 text-orange-900 border-orange-300",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

const SOURCE_LABEL: Record<string, string> = {
  outlook_email: "Email",
  outlook_calendar: "Calendar",
  slack: "Slack",
  zoom: "Zoom",
  salesforce: "Salesforce",
  context_note: "Note",
};

async function loadAccountDetail(id: string) {
  const database = db();

  const entityRows = await database
    .select()
    .from(schema.entities)
    .where(and(eq(schema.entities.id, id), eq(schema.entities.kind, "account")))
    .limit(1);

  if (entityRows.length === 0) return null;
  const account = entityRows[0];

  const signalRows = await database
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.entityId, id))
    .orderBy(desc(schema.signals.detectedAt))
    .limit(50);

  const claimRows = await database
    .select({
      id: schema.claims.id,
      statement: schema.claims.statement,
      moduleId: schema.claims.moduleId,
      confidence: schema.claims.confidence,
      sensitivity: schema.claims.sensitivity,
      createdAt: schema.claims.createdAt,
      sourceSystem: schema.evidenceLedger.sourceSystem,
      sourceUrl: schema.evidenceLedger.sourceUrl,
      sourceTimestamp: schema.evidenceLedger.sourceTimestamp,
    })
    .from(schema.claims)
    .leftJoin(schema.evidenceLedger, eq(schema.claims.ledgerId, schema.evidenceLedger.id))
    .where(eq(schema.claims.entityId, id))
    .orderBy(desc(schema.evidenceLedger.sourceTimestamp))
    .limit(60);

  const sourceCounts = await database
    .select({
      source: schema.evidenceLedger.sourceSystem,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.claims)
    .leftJoin(schema.evidenceLedger, eq(schema.claims.ledgerId, schema.evidenceLedger.id))
    .where(eq(schema.claims.entityId, id))
    .groupBy(schema.evidenceLedger.sourceSystem);

  // Pull related opportunities: opp entities whose Salesforce claims share this account
  const oppNames = await database
    .select({ name: schema.entities.name, id: schema.entities.id })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.kind, "opportunity"),
        inArray(
          schema.entities.id,
          database
            .select({ id: schema.claims.entityId })
            .from(schema.claims)
            .leftJoin(
              schema.evidenceLedger,
              eq(schema.claims.ledgerId, schema.evidenceLedger.id),
            )
            .where(
              and(
                eq(schema.evidenceLedger.sourceSystem, "salesforce"),
                sql`${schema.claims.attributes}->>'account_name' = ${account.name}`,
              ),
            ),
        ),
      ),
    )
    .limit(20)
    .catch(() => [] as Array<{ id: string; name: string }>);

  // Latest scores per kind
  const scoreRows = await database
    .select()
    .from(schema.accountScores)
    .where(eq(schema.accountScores.accountId, id))
    .orderBy(desc(schema.accountScores.computedAt));
  const latestScoreByKind = new Map<string, typeof scoreRows[number]>();
  for (const s of scoreRows) {
    if (!latestScoreByKind.has(s.kind)) latestScoreByKind.set(s.kind, s);
  }

  return {
    account,
    signals: signalRows,
    claims: claimRows,
    sourceCounts,
    opps: oppNames,
    scores: Array.from(latestScoreByKind.values()),
  };
}

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadAccountDetail(id);
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <Link href="/accounts" className="text-sm text-slate-500 hover:text-slate-700">
          ← Accounts
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{data.account.name}</h1>
        <div className="mt-3">
          <a
            href={`/chat/from-account/${data.account.id}`}
            className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Discuss this account with Claude →
          </a>
        </div>
        {data.account.externalId ? (
          <div className="mt-1 font-mono text-xs text-slate-400">{data.account.externalId}</div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
          <span>
            <strong>{data.signals.length}</strong> signals
          </span>
          <span>·</span>
          <span>
            <strong>{data.claims.length}</strong> claims
          </span>
          {data.sourceCounts.map((s) => (
            <span key={s.source ?? "unknown"}>
              · {s.count} {SOURCE_LABEL[s.source ?? ""] ?? s.source}
            </span>
          ))}
        </div>
      </div>

      {data.scores.length > 0 ? (
        <section className="mb-8 grid gap-3 sm:grid-cols-3">
          {data.scores.map((s) => {
            const color =
              s.kind === "churn_likelihood"
                ? s.score > 60
                  ? "bg-red-50 text-red-900 border-red-300"
                  : s.score > 30
                    ? "bg-amber-50 text-amber-900 border-amber-300"
                    : "bg-green-50 text-green-900 border-green-300"
                : s.kind === "expansion_potential"
                  ? s.score > 60
                    ? "bg-green-50 text-green-900 border-green-300"
                    : "bg-slate-50 text-slate-700 border-slate-200"
                  : s.score > 60
                    ? "bg-green-50 text-green-900 border-green-300"
                    : s.score > 30
                      ? "bg-amber-50 text-amber-900 border-amber-300"
                      : "bg-red-50 text-red-900 border-red-300";
            return (
              <div key={s.id} className={`rounded-md border p-3 ${color}`}>
                <div className="text-xs uppercase tracking-wider opacity-70">
                  {s.kind.replace(/_/g, " ")}
                </div>
                <div className="mt-1 text-3xl font-semibold">{s.score}</div>
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer opacity-70">why</summary>
                  <p className="mt-1 opacity-90">{s.reasoningMd}</p>
                </details>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium text-slate-900">Signals</h2>
        {data.signals.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No signals attached to this account yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.signals.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/signals/${s.id}`}
                  className={`block rounded-md border p-3 hover:shadow-sm ${SEVERITY_STYLE[s.severity] ?? "bg-white"}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="uppercase tracking-wider opacity-70">
                      {s.moduleId} · {s.kind}
                    </span>
                    <span className="opacity-60">
                      {new Date(s.detectedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{s.title}</div>
                  <div className="text-sm opacity-80">{s.summary}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-900">Claims (last 60)</h2>
        {data.claims.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No claims attached.
          </p>
        ) : (
          <ul className="space-y-1">
            {data.claims.map((c) => (
              <li
                key={c.id}
                className="rounded border-l-2 border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <div className="text-slate-900">{c.statement}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {SOURCE_LABEL[c.sourceSystem ?? ""] ?? c.sourceSystem}
                  {c.sourceTimestamp
                    ? ` · ${new Date(c.sourceTimestamp).toLocaleDateString()}`
                    : ""}
                  {c.moduleId ? ` · ${c.moduleId}` : ""}
                  {c.sensitivity === "private_dm" ? " · private" : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
