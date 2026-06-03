"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface ResearchPayload {
  account_name?: string;
  research?: {
    summary_md: string;
    recent_news?: Array<{
      headline: string;
      date?: string;
      url?: string;
      relevance_to_eric?: string;
    }>;
    funding_events?: Array<{
      round: string;
      amount?: string;
      date?: string;
      notes?: string;
    }>;
    leadership_changes?: Array<{
      person: string;
      role: string;
      change_type: string;
      date?: string;
    }>;
    regulatory_or_compliance?: Array<{ topic: string; date?: string; notes?: string }>;
    citations?: Array<{ url: string; title?: string; published_date?: string }>;
  };
}

export function AccountResearchPanel({
  accountId,
  existing,
}: {
  accountId: string;
  existing: { id: string; collectedAt: string; payload: ResearchPayload } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  async function trigger() {
    setSubmitted(false);
    try {
      const res = await fetch(`/api/accounts/${accountId}/research`, {
        method: "POST",
      });
      if (res.ok) {
        setSubmitted(true);
        setTimeout(() => startTransition(() => router.refresh()), 25000);
      }
    } catch {
      setSubmitted(false);
    }
  }

  const research = existing?.payload.research;
  return (
    <section className="mb-8 rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
          External research
        </h2>
        <button
          type="button"
          onClick={trigger}
          disabled={pending}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitted ? "↻ Researching… (~25s)" : existing ? "Re-run research" : "Research this company"}
        </button>
      </div>

      {existing ? (
        <>
          <div className="mb-2 text-xs text-slate-500">
            Last run: {new Date(existing.collectedAt).toLocaleString()}
          </div>
          <article className="whitespace-pre-wrap text-sm text-slate-900">
            {research?.summary_md}
          </article>

          {research?.recent_news && research.recent_news.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Recent news ({research.recent_news.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {research.recent_news.map((n, i) => (
                  <li key={i} className="rounded border-l-2 border-blue-200 pl-3">
                    <div className="font-medium text-slate-900">
                      {n.url ? (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {n.headline}
                        </a>
                      ) : (
                        n.headline
                      )}
                    </div>
                    {n.date ? <div className="text-xs text-slate-500">{n.date}</div> : null}
                    {n.relevance_to_eric ? (
                      <div className="mt-1 text-xs text-slate-600">{n.relevance_to_eric}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {research?.funding_events && research.funding_events.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Funding ({research.funding_events.length})
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {research.funding_events.map((f, i) => (
                  <li key={i}>
                    · {f.round} {f.amount ? `(${f.amount})` : ""} {f.date ? `· ${f.date}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {research?.leadership_changes && research.leadership_changes.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Leadership ({research.leadership_changes.length})
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {research.leadership_changes.map((l, i) => (
                  <li key={i}>
                    · {l.person} — {l.role} ({l.change_type}) {l.date ? `· ${l.date}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {research?.regulatory_or_compliance && research.regulatory_or_compliance.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Regulatory ({research.regulatory_or_compliance.length})
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {research.regulatory_or_compliance.map((r, i) => (
                  <li key={i}>
                    · {r.topic} {r.date ? `(${r.date})` : ""} {r.notes ? `— ${r.notes}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {research?.citations && research.citations.length > 0 ? (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-slate-500">
                {research.citations.length} sources
              </summary>
              <ul className="mt-2 space-y-1">
                {research.citations.map((c, i) => (
                  <li key={i}>
                    ·{" "}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {c.title ?? c.url}
                    </a>
                    {c.published_date ? ` (${c.published_date})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          {submitted
            ? "Research queued. Refresh in ~25 seconds for results."
            : "Click the button above to gather recent news, funding, leadership, and regulatory updates from the public web. Results combine with internal signals on chat + briefings."}
        </p>
      )}
    </section>
  );
}
