"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface DecisionFrame {
  question: string;
  options: Array<{ label: string; tradeoff: string }>;
  recommendation: string;
  reasoning: string;
}

export function DecisionFrameClient({
  situationId,
  frame,
  chosenLabel,
}: {
  situationId: string;
  frame: DecisionFrame;
  chosenLabel?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState(chosenLabel ?? null);

  async function choose(label: string) {
    setChosen(label);
    try {
      await fetch(`/api/situations/${situationId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionLabel: label }),
      });
      startTransition(() => router.refresh());
    } catch {
      setChosen(chosenLabel ?? null);
    }
  }

  return (
    <section className="mb-8 rounded-md border border-purple-200 bg-purple-50 p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-purple-700">
        Decision frame
      </h2>
      <p className="text-sm font-medium text-purple-900">{frame.question}</p>
      <ul className="mt-3 space-y-2">
        {frame.options.map((opt) => {
          const isChosen = chosen === opt.label;
          return (
            <li
              key={opt.label}
              className={`rounded p-2 text-sm transition ${
                isChosen ? "bg-purple-200 ring-2 ring-purple-400" : "bg-white/70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-purple-900">{opt.label}</div>
                  <div className="text-purple-800">{opt.tradeoff}</div>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(opt.label)}
                  className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                    isChosen
                      ? "bg-purple-700 text-white"
                      : "bg-purple-600 text-white hover:bg-purple-700"
                  }`}
                >
                  {isChosen ? "✓ Chosen" : "Choose"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-purple-900">
        <strong>Recommendation:</strong> {frame.recommendation}
      </p>
      <p className="mt-1 text-xs text-purple-700">{frame.reasoning}</p>
    </section>
  );
}
