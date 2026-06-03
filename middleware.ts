import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Single-user session gate + lightweight rate limiting.
 *
 * Auth model: the whole app is gated by a signed session cookie (set by /api/auth/login after
 * a password check). Machine endpoints authenticate with their OWN secrets and are exempt from
 * the human gate so the data pipeline keeps working:
 *   - /api/ingest, /api/ingest/csv  → COS_INGEST_TOKEN bearer
 *   - /api/inngest                  → Inngest request signature
 *   - /api/cron                     → CRON_SECRET (+ Vercel Cron)
 *   - /api/health                   → public health probe
 * The login UI (/login, /api/auth/*) is necessarily public too.
 *
 * Reads COS_SESSION_SECRET straight from process.env (not lib/env) to keep the Edge bundle
 * lean and avoid pulling the full zod validation into middleware.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

/** Per-route request ceilings within WINDOW_MS. */
function limitFor(pathname: string): number | null {
  if (pathname.startsWith("/api/auth/login")) return 10; // throttle password guessing
  if (pathname.startsWith("/api/ingest")) return 60; // absorb misbehaving extraction agents
  return null;
}

function rateLimit(req: NextRequest): NextResponse | null {
  const pathname = req.nextUrl.pathname;
  const max = limitFor(pathname);
  if (max === null) return null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const key = `${ip}:${pathname}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return NextResponse.json(
      { success: false, error: "Too many requests", duration: 0 },
      { status: 429 },
    );
  }
  return null;
}

/** Paths that bypass the human session gate. */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/ingest",
  "/api/inngest",
  "/api/cron",
  "/api/health",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = process.env.COS_SESSION_SECRET;
  if (!secret) {
    // Misconfigured. Fail closed in production; allow local dev so it isn't blocked w/o setup.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(
        "Auth not configured: set COS_SESSION_SECRET and COS_APP_PASSWORD",
        { status: 503 },
      );
    }
    return NextResponse.next();
  }

  const ok = await verifySessionToken(secret, req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: "Unauthorized", duration: 0 },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
  ],
};
