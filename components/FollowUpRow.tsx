"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function FollowUpRow({
  id,
  title,
  dueAt,
}: {
  id: string;
  title: string;
  dueAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  async function complete() {
    setDone(true);
    try {
      await fetch(`/api/follow-ups/${id}/complete`, { method: "POST" });
      startTransition(() => router.refresh());
    } catch {
      setDone(false);
    }
  }

  if (done) return null;

  return (
    <li className="flex items-center justify-between rounded border-l-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={complete}
          disabled={pending}
          className="h-4 w-4 rounded border border-amber-400 text-xs hover:bg-amber-100"
          title="Mark complete"
        />
        <span>{title}</span>
      </div>
      <span className="text-xs text-amber-700">
        {new Date(dueAt).toLocaleDateString()}
      </span>
    </li>
  );
}
