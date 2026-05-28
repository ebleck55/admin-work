"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function MarkReadButton({ id, alreadyRead }: { id: string; alreadyRead: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [read, setRead] = useState(alreadyRead);

  if (read) {
    return <span className="text-xs text-slate-400">read</span>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setRead(true);
        try {
          await fetch(`/api/notifications/${id}/read`, { method: "POST" });
          startTransition(() => router.refresh());
        } catch {
          setRead(false);
        }
      }}
      className="text-xs text-blue-600 underline disabled:opacity-50"
    >
      Mark read
    </button>
  );
}
