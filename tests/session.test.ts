import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  safeEqualSecret,
} from "@/lib/auth/session";

const SECRET = "test-secret-at-least-16-chars-long";

describe("session tokens", () => {
  it("verifies a freshly created token", async () => {
    const token = await createSessionToken(SECRET, { ttlMs: 60_000 });
    expect(await verifySessionToken(SECRET, token)).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SECRET, { ttlMs: 60_000 });
    expect(await verifySessionToken("another-secret-16chars+", token)).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const token = await createSessionToken(SECRET, { ttlMs: 60_000 });
    const [, sig] = token.split(".");
    const forged = `${Buffer.from('{"iat":0,"exp":99999999999999}').toString("base64url")}.${sig}`;
    expect(await verifySessionToken(SECRET, forged)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(SECRET, { ttlMs: -1 });
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("rejects empty/garbage tokens", async () => {
    expect(await verifySessionToken(SECRET, undefined)).toBe(false);
    expect(await verifySessionToken(SECRET, "")).toBe(false);
    expect(await verifySessionToken(SECRET, "not.a.valid.token")).toBe(false);
  });
});

describe("safeEqualSecret", () => {
  it("matches identical secrets and rejects different ones", async () => {
    expect(await safeEqualSecret("hunter2", "hunter2")).toBe(true);
    expect(await safeEqualSecret("hunter2", "hunter3")).toBe(false);
    expect(await safeEqualSecret("", "hunter2")).toBe(false);
  });
});
