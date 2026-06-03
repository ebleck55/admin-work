/**
 * Password login. Verifies the submitted password against COS_APP_PASSWORD (constant-time)
 * and, on success, sets a signed HttpOnly session cookie. Rate-limited in middleware.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  safeEqualSecret,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const expected = process.env.COS_APP_PASSWORD;
  const secret = process.env.COS_SESSION_SECRET;
  if (!expected || !secret) {
    return NextResponse.json(
      { success: false, error: "Auth not configured" },
      { status: 503 },
    );
  }

  let password: unknown;
  try {
    password = (await req.json())?.password;
  } catch {
    password = undefined;
  }

  if (typeof password !== "string" || !(await safeEqualSecret(password, expected))) {
    return NextResponse.json({ success: false, error: "Invalid password" }, { status: 401 });
  }

  const token = await createSessionToken(secret, { ttlMs: SESSION_TTL_MS });
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
