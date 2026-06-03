/**
 * Stateless signed-session tokens for the single-user app gate.
 *
 * Uses only Web Crypto + TextEncoder/btoa so it runs in BOTH the Edge runtime (middleware)
 * and the Node runtime (the login route). No external deps, no DB. A token is
 *   base64url(payload) "." base64url(HMAC-SHA256(payload))
 * where payload is { iat, exp }. Verification checks the signature (constant-time) and expiry.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

/** Constant-time equality for two same-length strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface SessionTokenOptions {
  /** Token lifetime in ms. */
  ttlMs: number;
}

export async function createSessionToken(secret: string, opts: SessionTokenOptions): Promise<string> {
  const now = Date.now();
  const payload = JSON.stringify({ iat: now, exp: now + opts.ttlMs });
  const body = bytesToBase64Url(encoder.encode(payload));
  const sig = bytesToBase64Url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const expected = bytesToBase64Url(await hmac(secret, body));
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(body))) as { exp?: number };
    return typeof payload.exp === "number" && Date.now() <= payload.exp;
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison of a user-supplied secret against the expected value. Hashes both
 * first so neither length nor content leaks through timing, regardless of input length.
 */
export async function safeEqualSecret(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(bytesToBase64Url(new Uint8Array(a)), bytesToBase64Url(new Uint8Array(b)));
}

export const SESSION_COOKIE = "cos_session";
/** 7-day session. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
