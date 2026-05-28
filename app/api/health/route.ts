import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, { ok: boolean; error?: string }> = {};
  try {
    await db().execute(sql`SELECT 1`);
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
