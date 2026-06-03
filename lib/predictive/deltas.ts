/**
 * Forecast-delta layer (Phase 3).
 *
 * The weekly scorer (lib/predictive/scorer.ts) writes a churn/expansion/engagement score per
 * account to `account_scores` each run. A single score is a snapshot; what an SVP actually
 * acts on is *movement*. This module turns the score history into ranked week-over-week deltas
 * with a plain-English "so-what", so the highest-leverage attention items surface first.
 *
 * Pure functions only — no DB/LLM — so the ranking logic is unit-tested deterministically.
 */

export type ScoreKind = "churn_likelihood" | "expansion_potential" | "engagement_health";

export interface ScoreRow {
  accountId: string;
  accountName?: string;
  kind: string;
  score: number;
  computedAt: Date;
}

export interface AccountDelta {
  accountId: string;
  accountName: string;
  kind: string;
  latest: number;
  previous: number | null;
  /** latest - previous (null previous → 0). */
  delta: number;
  latestAt: Date;
  previousAt: Date | null;
  /** True when the movement is the bad direction for this metric. */
  adverse: boolean;
  /** Plain-English summary of what moved and why it matters. */
  soWhat: string;
}

/** For churn, higher is worse; for expansion/engagement, lower is worse. */
function isAdverse(kind: string, delta: number): boolean {
  if (delta === 0) return false;
  return kind === "churn_likelihood" ? delta > 0 : delta < 0;
}

function label(kind: string): string {
  switch (kind) {
    case "churn_likelihood":
      return "churn risk";
    case "expansion_potential":
      return "expansion potential";
    case "engagement_health":
      return "engagement health";
    default:
      return kind;
  }
}

function soWhatFor(kind: string, delta: number, latest: number, name: string): string {
  const dir = delta > 0 ? "up" : "down";
  const mag = Math.abs(delta);
  if (kind === "churn_likelihood") {
    return delta > 0
      ? `${name}'s churn risk rose ${mag} pts to ${latest}/100 — get ahead of it before the renewal conversation.`
      : `${name}'s churn risk eased ${mag} pts to ${latest}/100.`;
  }
  if (kind === "expansion_potential") {
    return delta < 0
      ? `${name}'s expansion potential dropped ${mag} pts to ${latest}/100 — a play may be slipping.`
      : `${name}'s expansion potential climbed ${mag} pts to ${latest}/100 — worth pressing now.`;
  }
  return delta < 0
    ? `${name}'s engagement fell ${mag} pts to ${latest}/100 (${dir}) — the account may be going quiet.`
    : `${name}'s engagement improved ${mag} pts to ${latest}/100.`;
}

/**
 * Collapse score history into one delta per (account, kind): latest vs the immediately prior
 * snapshot. Accounts with only one snapshot get previous=null, delta=0 (no movement yet).
 */
export function computeScoreDeltas(rows: ScoreRow[]): AccountDelta[] {
  const groups = new Map<string, ScoreRow[]>();
  for (const r of rows) {
    const key = `${r.accountId}::${r.kind}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const out: AccountDelta[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime());
    const latest = list[0];
    const previous = list[1] ?? null;
    const delta = previous ? latest.score - previous.score : 0;
    const name = latest.accountName ?? "(unknown account)";
    out.push({
      accountId: latest.accountId,
      accountName: name,
      kind: latest.kind,
      latest: latest.score,
      previous: previous ? previous.score : null,
      delta,
      latestAt: latest.computedAt,
      previousAt: previous ? previous.computedAt : null,
      adverse: isAdverse(latest.kind, delta),
      soWhat: soWhatFor(latest.kind, delta, latest.score, name),
    });
  }
  return out;
}

/**
 * Rank movers that need attention: adverse movements first, by magnitude. Non-adverse and
 * unmoved entries are dropped (this is the "what changed for the worse" feed).
 */
export function rankMovers(deltas: AccountDelta[]): AccountDelta[] {
  return deltas
    .filter((d) => d.adverse)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export { isAdverse, label };
