"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SynthesizeButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "fired" | "error">("idle");

  async function fire() {
    setStatus("idle");
    try {
      const res = await fetch("/api/situations/synthesize", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setStatus("fired");
      // Give Inngest a moment, then refresh
      setTimeout(() => startTransition(() => router.refresh()), 8000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <button
      type="button"
      onClick={fire}
      disabled={pending}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 disabled:opacity-50"
    >
      {status === "fired"
        ? "↻ Synthesizing… (refresh ~30s)"
        : status === "error"
          ? "✗ Failed — retry"
          : "↻ Re-synthesize"}
    </button>
  );
}
