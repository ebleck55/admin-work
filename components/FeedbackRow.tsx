"use client";

import { useState } from "react";

const REASON_OPTIONS = [
  "Not relevant to my role",
  "Already knew this",
  "Wrong severity",
  "False positive",
  "Wrong account/entity",
];

export function FeedbackRow({
  targetKind,
  targetId,
}: {
  targetKind: "signal" | "situation";
  targetId: string;
}) {
  const [voted, setVoted] = useState<"up" | "down" | "not_relevant" | null>(null);
  const [showReasons, setShowReasons] = useState(false);

  async function submit(valence: "up" | "down" | "not_relevant", reason?: string) {
    setVoted(valence);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKind,
          targetId,
          valence,
          reasonCategory: reason ?? null,
        }),
      });
      setShowReasons(false);
    } catch {
      setVoted(null);
    }
  }

  if (voted) {
    return (
      <span className="text-xs text-slate-500">
        {voted === "up" ? "👍 Thanks" : voted === "down" ? "👎 Got it" : "✕ Suppressed"}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => submit("up")}
        className="rounded px-1 hover:bg-white/60"
        title="Useful"
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => setShowReasons((v) => !v)}
        className="rounded px-1 hover:bg-white/60"
        title="Not useful — pick a reason"
      >
        👎
      </button>
      {showReasons ? (
        <span className="absolute mt-6 flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-2 shadow-md">
          {REASON_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => submit("down", r)}
              className="rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            onClick={() => submit("not_relevant", "skip")}
            className="rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50"
          >
            Suppress all like this
          </button>
        </span>
      ) : null}
    </span>
  );
}
