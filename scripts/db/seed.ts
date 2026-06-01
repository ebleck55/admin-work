#!/usr/bin/env -S npx tsx
/**
 * Seed the database with realistic sample envelopes spanning all 8 modules.
 *
 * Run with: npm run seed
 * Requires: DATABASE_URL set; schema already pushed via npm run db:push.
 *
 * What it inserts:
 *   - 1 user (Eric)
 *   - 5 accounts (FinServ-flavored fictional banks)
 *   - 5 opportunities, 4 reps, 3 initiatives, 4 competitor stubs
 *   - ~30 envelopes spanning Outlook/Slack/Zoom/Salesforce, each with
 *     module-relevant claims so the detectors fire and dashboards populate.
 *
 * Idempotent (uses the writeEnvelope() idempotency on source_system + source_id).
 */

import { writeEnvelope } from "@/lib/ingestion/ledger";
import { db, schema } from "@/lib/db/client";
import type { PayloadEnvelope } from "@/lib/ingestion/envelope";

const TODAY = new Date();
const isoOffset = (daysAgo: number, hour = 9, minute = 0) => {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

const COLLECTED = TODAY.toISOString();

function envelope(partial: Partial<PayloadEnvelope> & { source_system: PayloadEnvelope["source_system"]; source_id: string }): PayloadEnvelope {
  return {
    collected_at: COLLECTED,
    source_timestamp: partial.source_timestamp ?? isoOffset(1),
    sensitivity: partial.sensitivity ?? "internal",
    entities: partial.entities ?? [],
    claims: partial.claims ?? [],
    evidence: partial.evidence ?? [],
    confidence: partial.confidence ?? 0.8,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ENVELOPES: PayloadEnvelope[] = [
  // --- Pipeline (Salesforce) ---
  envelope({
    source_system: "salesforce",
    source_id: "OPP-AURORA-001@2026-05-28",
    source_timestamp: isoOffset(0),
    actor: "Maya Chen",
    entities: [
      { kind: "opportunity", name: "Aurora Bank — Process Mining", external_id: "OPP-AURORA-001" },
      { kind: "account", name: "Aurora Bank", external_id: "ACC-AURORA" },
      { kind: "rep", name: "Maya Chen" },
    ],
    claims: [
      { statement: "Aurora Bank — Process Mining is in stage \"Proposal\".", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Aurora Bank — Process Mining" }, attributes: { field: "stage", stage: "Proposal" }, confidence: 0.85 },
      { statement: "Aurora Bank — Process Mining has amount $450,000.", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Aurora Bank — Process Mining" }, attributes: { field: "amount", amount: 450000 }, confidence: 0.85 },
      { statement: "Next step on Aurora: SOC 2 letter to CISO by next Friday.", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Aurora Bank — Process Mining" }, attributes: { field: "next_step" }, confidence: 0.85 },
    ],
    title: "Aurora Bank — Process Mining (Salesforce)",
  }),
  envelope({
    source_system: "salesforce",
    source_id: "OPP-LIBERTY-007@2026-05-28",
    source_timestamp: isoOffset(0),
    actor: "Dev Patel",
    entities: [
      { kind: "opportunity", name: "Liberty Federal — Citizen Dev Expansion", external_id: "OPP-LIBERTY-007" },
      { kind: "account", name: "Liberty Federal", external_id: "ACC-LIBERTY" },
      { kind: "rep", name: "Dev Patel" },
    ],
    claims: [
      { statement: "Liberty Federal is in stage \"Stalled\".", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Liberty Federal — Citizen Dev Expansion" }, attributes: { field: "stage", stage: "Stalled" }, confidence: 0.9 },
      { statement: "Liberty Federal — Citizen Dev Expansion amount $220,000.", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Liberty Federal — Citizen Dev Expansion" }, attributes: { field: "amount", amount: 220000 }, confidence: 0.9 },
    ],
    title: "Liberty Federal — stalled deal",
  }),
  envelope({
    source_system: "salesforce",
    source_id: "OPP-CENTAUR-019@2026-05-28",
    source_timestamp: isoOffset(0),
    actor: "Priya Shah",
    entities: [
      { kind: "opportunity", name: "Centaur Capital — Trading Ops", external_id: "OPP-CENTAUR-019" },
      { kind: "account", name: "Centaur Capital", external_id: "ACC-CENTAUR" },
      { kind: "rep", name: "Priya Shah" },
    ],
    claims: [
      { statement: "Centaur Capital — Trading Ops is in stage \"Closed Won\".", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Centaur Capital — Trading Ops" }, attributes: { field: "stage", stage: "Closed Won" }, confidence: 0.95 },
      { statement: "Centaur expansion: customer asked about additional licenses for the EMEA trading team.", module_id: "pipeline", entity_ref: { kind: "opportunity", name: "Centaur Capital — Trading Ops" }, confidence: 0.85 },
    ],
    title: "Centaur Capital — Closed Won + expansion ask",
  }),

  // --- CS (Outlook + Zoom) ---
  envelope({
    source_system: "outlook_email",
    source_id: "msg-aurora-cs-001",
    source_timestamp: isoOffset(1, 14, 32),
    actor: "ciso@aurora-bank.example.com",
    entities: [
      { kind: "account", name: "Aurora Bank" },
      { kind: "contact", name: "Aurora Bank CISO" },
    ],
    claims: [
      { statement: "Aurora's CISO confirmed they need the SOC 2 Type 2 letter before legal review.", module_id: "cs", entity_ref: { kind: "account", name: "Aurora Bank" }, confidence: 0.85 },
      { statement: "Aurora is also asking about FedRAMP roadmap for the FS vertical.", module_id: "finserv", entity_ref: { kind: "account", name: "Aurora Bank" }, confidence: 0.8 },
    ],
    evidence: [
      { claim_index: 0, quote: "We'll need the SOC 2 Type 2 letter in hand before we can move this to legal review next quarter — please confirm by Friday." },
      { claim_index: 1, quote: "Procurement is curious about FedRAMP — is that on the roadmap for FS?" },
    ],
    raw_text: "Meeting notes from Aurora Bank security review. CISO confirmed they need the SOC 2 Type 2 letter before legal review. Procurement asked about FedRAMP roadmap. Action: send SOC 2 letter; draft FedRAMP one-pager.",
    title: "Aurora Bank — security review followup",
  }),
  envelope({
    source_system: "outlook_email",
    source_id: "msg-meridian-cs-001",
    source_timestamp: isoOffset(2, 16, 10),
    actor: "vp-ops@meridian-trust.example.com",
    entities: [{ kind: "account", name: "Meridian Trust" }],
    claims: [
      { statement: "Meridian's VP of Ops is frustrated by the slow time-to-value and may not renew their license without seeing concrete ROI numbers.", module_id: "cs", entity_ref: { kind: "account", name: "Meridian Trust" }, confidence: 0.9 },
    ],
    evidence: [
      { claim_index: 0, quote: "We're frustrated by the pace — if we don't see real ROI numbers by Q3, we'll be evaluating alternatives. May not renew without that." },
    ],
    raw_text: "Email thread with Meridian Trust VP Ops. Sentiment is sharply negative on time-to-value. Risk of non-renewal at Q3.",
    title: "Meridian Trust — health risk",
  }),
  envelope({
    source_system: "zoom",
    source_id: "zoom-centaur-qbr-001",
    source_timestamp: isoOffset(3, 20, 0),
    actor: "Centaur Capital QBR",
    entities: [{ kind: "account", name: "Centaur Capital" }],
    claims: [
      { statement: "Centaur Capital interested in expanding to a new business unit in EMEA next quarter.", module_id: "cs", entity_ref: { kind: "account", name: "Centaur Capital" }, confidence: 0.85 },
    ],
    raw_text: "QBR transcript with Centaur Capital. CRO mentioned EMEA expansion plans and asked about pricing for a new business unit rollout.",
    title: "Centaur QBR — EMEA expansion ask",
  }),

  // --- Team (Slack + Zoom) ---
  envelope({
    source_system: "slack",
    source_id: "slack-team-coaching-001",
    source_timestamp: isoOffset(1, 11, 23),
    actor: "Eric Bouchard",
    sensitivity: "internal",
    entities: [{ kind: "rep", name: "Dev Patel" }],
    claims: [
      { statement: "Dev Patel was stuck on the Liberty Federal demo when asked about FedRAMP timeline; needs coaching on the FS compliance narrative.", module_id: "team", entity_ref: { kind: "rep", name: "Dev Patel" }, confidence: 0.85 },
    ],
    raw_text: "Sales-coaching channel: Dev Patel was stuck on the Liberty Federal demo when asked about FedRAMP timeline. Couldn't answer the procurement question. Needs coaching on the FS compliance narrative.",
    title: "Dev Patel coaching note",
  }),
  envelope({
    source_system: "slack",
    source_id: "slack-team-commit-001",
    source_timestamp: isoOffset(0, 8, 15),
    actor: "Maya Chen",
    entities: [{ kind: "rep", name: "Maya Chen" }],
    claims: [
      { statement: "Maya committed to deliver the Aurora Bank SOC 2 letter by Friday EOD.", module_id: "team", entity_ref: { kind: "rep", name: "Maya Chen" }, confidence: 0.9 },
    ],
    title: "Maya Chen commitment",
  }),

  // --- Initiatives (Outlook) ---
  envelope({
    source_system: "outlook_email",
    source_id: "msg-init-fedramp-001",
    source_timestamp: isoOffset(2, 13, 12),
    actor: "compliance@uipath.com",
    entities: [{ kind: "initiative", name: "FedRAMP Moderate" }],
    claims: [
      { statement: "FedRAMP Moderate is blocked waiting on the 3PAO assessment kickoff; missed the original April milestone.", module_id: "initiatives", entity_ref: { kind: "initiative", name: "FedRAMP Moderate" }, confidence: 0.85 },
    ],
    title: "FedRAMP blocker",
  }),
  envelope({
    source_system: "outlook_email",
    source_id: "msg-init-zerotrust-001",
    source_timestamp: isoOffset(5, 10, 0),
    actor: "platform@uipath.com",
    entities: [{ kind: "initiative", name: "Zero-Trust Network Migration" }],
    claims: [
      { statement: "Zero-Trust Network Migration shipped to production for the FS vertical's pilot.", module_id: "initiatives", entity_ref: { kind: "initiative", name: "Zero-Trust Network Migration" }, confidence: 0.95 },
    ],
    title: "Zero-Trust milestone",
  }),

  // --- FinServ regulatory mentions across sources ---
  envelope({
    source_system: "slack",
    source_id: "slack-finserv-nydfs-001",
    source_timestamp: isoOffset(0, 9, 47),
    actor: "Priya Shah",
    entities: [{ kind: "account", name: "Centaur Capital" }],
    claims: [
      { statement: "Centaur Capital is asking about NYDFS Part 500 compliance attestation for automation workflows.", entity_ref: { kind: "account", name: "Centaur Capital" }, confidence: 0.9 },
    ],
    title: "NYDFS — Centaur",
  }),
  envelope({
    source_system: "outlook_email",
    source_id: "msg-finserv-aml-001",
    source_timestamp: isoOffset(4, 15, 23),
    actor: "ops@parkway-savings.example.com",
    entities: [{ kind: "account", name: "Parkway Savings" }],
    claims: [
      { statement: "Parkway Savings flagged a question about AML / BSA documentation requirements for the new transaction-monitoring bot.", entity_ref: { kind: "account", name: "Parkway Savings" }, confidence: 0.8 },
    ],
    title: "Parkway — AML question",
  }),

  // --- Competitive mentions ---
  envelope({
    source_system: "zoom",
    source_id: "zoom-meridian-comp-001",
    source_timestamp: isoOffset(2, 18, 5),
    actor: "Meridian Trust call",
    entities: [{ kind: "account", name: "Meridian Trust" }],
    claims: [
      { statement: "Meridian Trust is also evaluating Pega and Automation Anywhere for the same automation use case.", entity_ref: { kind: "account", name: "Meridian Trust" }, confidence: 0.85 },
    ],
    title: "Meridian competitive eval",
  }),
  envelope({
    source_system: "slack",
    source_id: "slack-comp-blueprism-001",
    source_timestamp: isoOffset(1, 17, 30),
    actor: "Maya Chen",
    entities: [{ kind: "account", name: "Liberty Federal" }],
    claims: [
      { statement: "Liberty Federal told us they're locked into a Blue Prism POC for the next 90 days.", entity_ref: { kind: "account", name: "Liberty Federal" }, confidence: 0.9 },
    ],
    title: "Liberty — Blue Prism POC",
  }),

  // --- Private DM (sensitivity gating demo) ---
  envelope({
    source_system: "slack",
    source_id: "slack-dm-private-001",
    source_timestamp: isoOffset(0, 7, 30),
    actor: "Eric Bouchard",
    sensitivity: "private_dm",
    entities: [{ kind: "account", name: "Aurora Bank" }],
    claims: [
      { statement: "Off-the-record: Aurora's CISO mentioned in DM they're considering alternatives if the SOC 2 letter slips again.", module_id: "cs", entity_ref: { kind: "account", name: "Aurora Bank" }, confidence: 0.8 },
    ],
    title: "Private — Aurora CISO DM",
  }),
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function postViaHttp(envelopes: PayloadEnvelope[], baseUrl: string, token: string) {
  let inserted = 0;
  let dup = 0;
  let failed = 0;
  for (const env of envelopes) {
    try {
      const res = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(env),
      });
      const body = (await res.json()) as { success: boolean; data?: { already_exists: boolean; ledger_id?: string }; error?: string };
      if (!res.ok || !body.success) {
        failed += 1;
        console.error(`  ! ${env.source_system}:${env.source_id} — HTTP ${res.status}: ${body.error ?? "(unknown)"}`);
        continue;
      }
      if (body.data?.already_exists) {
        dup += 1;
      } else {
        inserted += 1;
        console.log(`  + ${env.source_system}:${env.source_id} → ${body.data?.ledger_id}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ! ${env.source_system}:${env.source_id} — ${err instanceof Error ? err.message : err}`);
    }
  }
  return { inserted, dup, failed };
}

async function main() {
  const baseUrl = process.env.COS_URL;
  const token = process.env.COS_INGEST_TOKEN;

  if (baseUrl && token) {
    console.log(`Seeding ${ENVELOPES.length} envelopes via ${baseUrl}/api/ingest (Inngest will fire)...`);
    const { inserted, dup, failed } = await postViaHttp(ENVELOPES, baseUrl, token);
    console.log(`\nDone. Inserted: ${inserted}, Duplicates: ${dup}, Failed: ${failed}`);
    return;
  }

  console.log(`Seeding ${ENVELOPES.length} envelopes directly to DB (Inngest NOT fired)...`);

  // Ensure a user exists
  const userRows = await db().select().from(schema.users).limit(1);
  if (userRows.length === 0) {
    await db().insert(schema.users).values({
      email: "eric.bouchard@uipath.com",
      displayName: "Eric Bouchard",
    });
    console.log("  + created user eric.bouchard@uipath.com");
  }

  let inserted = 0;
  let dup = 0;
  for (const env of ENVELOPES) {
    try {
      const r = await writeEnvelope(env);
      if (r.alreadyExists) {
        dup += 1;
      } else {
        inserted += 1;
        console.log(`  + ${env.source_system}:${env.source_id} (${r.claimIds.length} claims, ${r.entityIds.length} entities)`);
      }
    } catch (err) {
      console.error(`  ! ${env.source_system}:${env.source_id} — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone. Inserted: ${inserted}, Duplicates: ${dup}`);
  console.log("\nNote: Inngest events are NOT auto-fired in this mode.");
  console.log("To fire Inngest events, set COS_URL + COS_INGEST_TOKEN and re-run.");
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
