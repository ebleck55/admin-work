"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface SituationOption {
  id: string;
  title: string;
}

export function MergeSituationsControl({
  candidates,
}: {
  candidates: SituationOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [canonicalId, setCanonicalId] = useState<string | "">("");
  const [mergeIds, setMergeIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function execute() {
    setError(null);
    if (!canonicalId) {
      setError("Pick a canonical situation first.");
      return;
    }
    if (mergeIds.size === 0) {
      setError("Pick at least one situation to merge into the canonical.");
      return;
    }
    if (mergeIds.has(canonicalId)) {
      setError("Canonical cannot also be in the merge list.");
      return;
    }
    try {
      const res = await fetch("/api/situations/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalId,
          mergeIds: Array.from(mergeIds),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      setCanonicalId("");
      setMergeIds(new Set());
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400"
      >
        Merge situations…
      </button>
    );
  }

  return (
    <div className="rounded-md border border-slate-300 bg-white p-3 text-xs">
      <p className="mb-2 text-slate-700">
        Pick the <strong>canonical</strong> situation (survives) and the situations to merge
        INTO it. Signals + actions transfer; merged narratives are appended to the canonical
        reasoning.
      </p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((s) => {
          const isCanonical = canonicalId === s.id;
          const isMerging = mergeIds.has(s.id);
          return (
            <li key={s.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setCanonicalId(isCanonical ? "" : s.id)
                }
                className={`rounded px-2 py-0.5 text-xs ${
                  isCanonical
                    ? "bg-green-600 text-white"
                    : "bg-green-100 text-green-800 hover:bg-green-200"
                }`}
              >
                {isCanonical ? "✓ canonical" : "canonical"}
              </button>
              <button
                type="button"
                disabled={isCanonical}
                onClick={() => {
                  const next = new Set(mergeIds);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  setMergeIds(next);
                }}
                className={`rounded px-2 py-0.5 text-xs disabled:opacity-30 ${
                  isMerging
                    ? "bg-amber-500 text-white"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                }`}
              >
                {isMerging ? "✓ merging" : "merge"}
              </button>
              <span
                className={`flex-1 truncate ${isCanonical ? "font-semibold" : ""}`}
              >
                {s.title}
              </span>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-red-700">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setCanonicalId("");
            setMergeIds(new Set());
            setError(null);
          }}
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={execute}
          disabled={pending || !canonicalId || mergeIds.size === 0}
          className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Merge {mergeIds.size > 0 ? `${mergeIds.size}` : ""} →
        </button>
      </div>
    </div>
  );
}
