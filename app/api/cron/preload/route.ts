import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { inngest } from "@/inngest/client";

/**
 * Daily morning briefing preload (Vercel Cron).
 * Schedule: `vercel.json` -> `0 11 * * *` (6am EST). Vercel sets the
 * `Authorization: Bearer <CRON_SECRET>` header on cron invocations.
 *
 * Pattern lifted from `bart-app/learning-quest-grade5/app/api/pregenerate/route.ts` —
 * we fire an Inngest event so the heavy work runs in the durable runtime instead
 * of inside the cron's 5-minute budget.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = env().CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const forDate = new Date().toISOString().slice(0, 10);
  await inngest.send({
    name: "briefing/preload.requested",
    data: { forDate },
  });

  return NextResponse.json({ ok: true, forDate, queued: true });
}
