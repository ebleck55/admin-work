"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const TIME_RANGES = [
  { value: "1d", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export function SignalFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentSince = params.get("since") ?? "7d";
  const currentSeverities = new Set((params.get("severity") ?? "").split(",").filter(Boolean));
  const [q, setQ] = useState(params.get("q") ?? "");

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
    },
    [params, router],
  );

  const toggleSeverity = (sev: string) => {
    const set = new Set(currentSeverities);
    if (set.has(sev)) set.delete(sev);
    else set.add(sev);
    updateParam("severity", set.size === 0 ? null : Array.from(set).join(","));
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <span className="text-xs uppercase tracking-wider text-slate-500">When:</span>
      {TIME_RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          disabled={pending}
          onClick={() => updateParam("since", r.value === "7d" ? null : r.value)}
          className={`rounded px-2 py-1 text-xs ${
            currentSince === r.value
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          {r.label}
        </button>
      ))}

      <span className="ml-3 text-xs uppercase tracking-wider text-slate-500">Severity:</span>
      {SEVERITIES.map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending}
          onClick={() => toggleSeverity(s)}
          className={`rounded px-2 py-1 text-xs capitalize ${
            currentSeverities.has(s)
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          {s}
        </button>
      ))}

      <input
        type="search"
        placeholder="Filter by text…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") updateParam("q", q || null);
        }}
        onBlur={() => updateParam("q", q || null)}
        className="ml-auto w-48 rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}
