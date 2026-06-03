import { describe, it, expect } from "vitest";
import { computeScoreDeltas, rankMovers, isAdverse } from "@/lib/predictive/deltas";
import type { ScoreRow } from "@/lib/predictive/deltas";

const d = (s: string) => new Date(s);

const rows: ScoreRow[] = [
  // Acme churn rose 30 -> 70 (adverse)
  { accountId: "acme", accountName: "Acme", kind: "churn_likelihood", score: 30, computedAt: d("2026-05-20") },
  { accountId: "acme", accountName: "Acme", kind: "churn_likelihood", score: 70, computedAt: d("2026-05-27") },
  // Meridian expansion fell 80 -> 60 (adverse)
  { accountId: "mer", accountName: "Meridian", kind: "expansion_potential", score: 80, computedAt: d("2026-05-20") },
  { accountId: "mer", accountName: "Meridian", kind: "expansion_potential", score: 60, computedAt: d("2026-05-27") },
  // Globex engagement rose 50 -> 65 (good, not adverse)
  { accountId: "glo", accountName: "Globex", kind: "engagement_health", score: 50, computedAt: d("2026-05-20") },
  { accountId: "glo", accountName: "Globex", kind: "engagement_health", score: 65, computedAt: d("2026-05-27") },
  // Initech only one snapshot
  { accountId: "ini", accountName: "Initech", kind: "churn_likelihood", score: 40, computedAt: d("2026-05-27") },
];

describe("isAdverse", () => {
  it("treats rising churn and falling expansion/engagement as adverse", () => {
    expect(isAdverse("churn_likelihood", 10)).toBe(true);
    expect(isAdverse("churn_likelihood", -10)).toBe(false);
    expect(isAdverse("expansion_potential", -10)).toBe(true);
    expect(isAdverse("engagement_health", -10)).toBe(true);
    expect(isAdverse("engagement_health", 10)).toBe(false);
    expect(isAdverse("churn_likelihood", 0)).toBe(false);
  });
});

describe("computeScoreDeltas", () => {
  it("computes latest-vs-previous per account+kind", () => {
    const deltas = computeScoreDeltas(rows);
    const acme = deltas.find((x) => x.accountId === "acme")!;
    expect(acme.latest).toBe(70);
    expect(acme.previous).toBe(30);
    expect(acme.delta).toBe(40);
    expect(acme.adverse).toBe(true);
  });

  it("handles single-snapshot accounts (no previous, no movement)", () => {
    const ini = computeScoreDeltas(rows).find((x) => x.accountId === "ini")!;
    expect(ini.previous).toBeNull();
    expect(ini.delta).toBe(0);
    expect(ini.adverse).toBe(false);
  });
});

describe("rankMovers", () => {
  it("returns only adverse movers, biggest first", () => {
    const movers = rankMovers(computeScoreDeltas(rows));
    expect(movers.map((m) => m.accountId)).toEqual(["acme", "mer"]);
    expect(movers[0].delta).toBe(40); // Acme churn +40 outranks Meridian expansion -20
  });
});
