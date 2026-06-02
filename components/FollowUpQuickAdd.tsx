"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function FollowUpQuickAdd({
  sourceKind,
  sourceId,
  defaultTitle = "",
}: {
  sourceKind: "situation" | "signal" | "account" | "note";
  sourceId?: string;
  defaultTitle?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(defaultTitle);
  const [dueOffset, setDueOffset] = useState<"1d" | "3d" | "7d" | "14d">("3d");
  const [submitted, setSubmitted] = useState(false);

  async function add() {
    if (!title.trim()) return;
    const days = parseInt(dueOffset.replace("d", ""), 10);
    const dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    try {
      await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueAt, sourceKind, sourceId }),
      });
      setSubmitted(true);
      setTitle("");
      startTransition(() => router.refresh());
      setTimeout(() => setSubmitted(false), 3000);
    } catch {
      setSubmitted(false);
    }
  }

  if (submitted) {
    return (
      <p className="rounded bg-green-50 px-3 py-2 text-xs text-green-800">
        ✓ Follow-up added. It will surface on the home view when due.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm sm:flex-row">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's the follow-up?"
        className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      />
      <select
        value={dueOffset}
        onChange={(e) => setDueOffset(e.target.value as "1d" | "3d" | "7d" | "14d")}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="1d">1 day</option>
        <option value="3d">3 days</option>
        <option value="7d">1 week</option>
        <option value="14d">2 weeks</option>
      </select>
      <button
        type="button"
        onClick={add}
        disabled={pending || !title.trim()}
        className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
      >
        + Add
      </button>
    </div>
  );
}
