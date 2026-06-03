"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FeedbackRow } from "@/components/FeedbackRow";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 border-red-300 text-red-900",
  high: "bg-orange-50 border-orange-300 text-orange-900",
  medium: "bg-amber-50 border-amber-200 text-amber-900",
  low: "bg-slate-50 border-slate-200 text-slate-700",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-200 text-red-900",
  high: "bg-orange-200 text-orange-900",
  medium: "bg-amber-200 text-amber-900",
  low: "bg-slate-200 text-slate-800",
};

export interface SituationCardData {
  id: string;
  title: string;
  severity: string;
  status: string;
  narrativeMd: string;
  recommendedAction: string | null;
  signalCount: number;
  entityName: string | null;
  entityId: string | null;
  hasDecisionFrame: boolean;
  updatedAt: string; // ISO
}

export function SituationCard({ situation }: { situation: SituationCardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  async function takeAction(kind: "acknowledge" | "snooze" | "resolve" | "escalate") {
    setHidden(true);
    try {
      await fetch(`/api/situations/${situation.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload: kind === "snooze" ? { hours: 24 } : {} }),
      });
      startTransition(() => router.refresh());
    } catch {
      setHidden(false);
    }
  }

  if (hidden) return null;

  return (
    <article
      className={`rounded-lg border p-4 transition-shadow hover:shadow-sm ${SEVERITY_STYLE[situation.severity] ?? "bg-white"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 font-medium uppercase tracking-wider ${SEVERITY_BADGE[situation.severity] ?? "bg-slate-200"}`}
          >
            {situation.severity}
          </span>
          {situation.status !== "open" ? (
            <span className="rounded-full bg-white/60 px-2 py-0.5 uppercase tracking-wider text-slate-600">
              {situation.status}
            </span>
          ) : null}
          {situation.hasDecisionFrame ? (
            <span className="rounded-full bg-purple-200 px-2 py-0.5 uppercase tracking-wider text-purple-900">
              decision
            </span>
          ) : null}
          {situation.entityName ? (
            <Link
              href={situation.entityId ? `/accounts/${situation.entityId}` : "#"}
              className="text-slate-600 hover:underline"
            >
              {situation.entityName}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href={`/chat/from-situation/${situation.id}`}
            className="rounded-md bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
          >
            Ask Claude →
          </Link>
          <Link
            href={`/chat/from-situation/${situation.id}?prompt=${encodeURIComponent(
              "Draft a Slack message AND an email to my team about resolving this situation. Match my voice from my prior memory facts and any preferences you've learned. One message per channel; lead with the ask.",
            )}`}
            className="rounded-md bg-white/80 px-2 py-1 font-medium text-slate-700 hover:bg-white"
          >
            Draft team comms →
          </Link>
          <Link
            href={`/situations/${situation.id}`}
            className="text-slate-500 hover:text-slate-800"
          >
            Open →
          </Link>
        </div>
      </div>

      <Link
        href={`/situations/${situation.id}`}
        className="mt-2 block text-base font-semibold leading-snug hover:underline"
      >
        {situation.title}
      </Link>

      <p className="mt-1 whitespace-pre-wrap text-sm leading-snug opacity-90">
        {situation.narrativeMd.slice(0, 280)}
        {situation.narrativeMd.length > 280 ? "…" : ""}
      </p>

      {situation.recommendedAction ? (
        <p className="mt-2 text-sm font-medium">
          <span className="opacity-70">Recommend:</span>{" "}
          {situation.recommendedAction}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-600">{situation.signalCount} signal{situation.signalCount === 1 ? "" : "s"}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">
          {new Date(situation.updatedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <FeedbackRow targetKind="situation" targetId={situation.id} />
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => takeAction("acknowledge")}
            className="rounded bg-white/80 px-2 py-1 hover:bg-white"
            title="Mark seen"
          >
            ✓ Ack
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => takeAction("snooze")}
            className="rounded bg-white/80 px-2 py-1 hover:bg-white"
            title="Hide for 24h"
          >
            ⏸ Snooze 24h
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => takeAction("escalate")}
            className="rounded bg-white/80 px-2 py-1 hover:bg-white"
            title="Surface to top"
          >
            ▲ Escalate
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => takeAction("resolve")}
            className="rounded bg-white/80 px-2 py-1 hover:bg-white"
            title="Close out"
          >
            ✕ Resolve
          </button>
        </span>
      </div>
    </article>
  );
}
