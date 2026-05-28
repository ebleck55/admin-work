import Link from "next/link";
import { desc } from "drizzle-orm";

import { db, schema } from "@/lib/db/client";
import { MarkReadButton } from "@/components/MarkReadButton";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  high: "bg-orange-100 text-orange-900 border-orange-300",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

async function loadNotifications() {
  return db()
    .select()
    .from(schema.notifications)
    .orderBy(desc(schema.notifications.createdAt))
    .limit(100);
}

export default async function NotificationsPage() {
  let notifications: Awaited<ReturnType<typeof loadNotifications>> = [];
  let loadError: string | null = null;
  try {
    notifications = await loadNotifications();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Notifications</h1>
        <p className="text-slate-600">High/critical signals from the last week.</p>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Could not load:</strong> {loadError}
        </div>
      ) : null}

      {notifications.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No notifications yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`rounded-md border p-3 ${SEVERITY_STYLE[n.severity] ?? "bg-white"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider opacity-70">
                  {n.severity}
                </span>
                <span className="text-xs opacity-60">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 text-sm font-medium">{n.title}</div>
              <div className="text-sm opacity-80">{n.body}</div>
              <div className="mt-2 flex items-center gap-3">
                {n.href ? (
                  <Link href={n.href} className="text-xs underline">
                    View →
                  </Link>
                ) : null}
                <MarkReadButton id={n.id} alreadyRead={n.readAt !== null} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
