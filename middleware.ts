import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight middleware. Per-route bearer checks live inside the routes themselves
 * (so envelopes are returned in the standard handler() format). Here we only enforce
 * basic rate limiting on `/api/ingest` to absorb misbehaving extraction agents.
 *
 * Pattern from `bart-app/server/index.js:148-186` — in-memory Map keyed by IP+route.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

function rateLimit(req: NextRequest): NextResponse | null {
  if (!req.nextUrl.pathname.startsWith("/api/ingest")) return null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const key = `${ip}:${req.nextUrl.pathname}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_PER_WINDOW) {
    return NextResponse.json(
      { success: false, error: "Too many requests", duration: 0 },
      { status: 429 },
    );
  }
  return null;
}

export function middleware(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/ingest", "/api/ingest/:path*"],
};
