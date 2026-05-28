# Chief of Staff — Setup

End-to-end checklist to bring the prototype online for the first time.

> Read this first before opening a Vercel project. Some steps (Neon, Google
> Cloud, Inngest) require account creation and propagation, so it's faster to
> set them up in parallel.

---

## 0. Prerequisites

- Node.js 20.x or 22.x locally (Vercel runtime is Node 22).
- A GitHub account with access to `ebleck55/admin-work`.
- A Vercel account.
- A Neon account.
- An Inngest account.
- An Anthropic API key (with sufficient quota for Opus 4.7).
- A Gemini API key (used for both fallback model + embeddings via
  `gemini-embedding-001`, truncated to 1536 dims via MRL).
- A Google Cloud project with the **Text-to-Speech API** enabled and an
  API key restricted to that API.
- Vercel Blob (created from the Vercel dashboard).

---

## 1. Provision Neon Postgres

1. Create a project in [Neon](https://console.neon.tech).
2. In the **SQL Editor**, enable pgvector:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Copy the **pooled connection string** (with `?sslmode=require`). Save as
   `DATABASE_URL` for later. The unpooled string is for migrations only; the
   pooled string is fine for the app since Drizzle uses the HTTP driver.

---

## 2. Push the database schema

From a local clone, with `DATABASE_URL` exported:

```bash
npm install
npm run db:push
```

This generates and applies the initial Drizzle schema (evidence_ledger,
claims, evidence_quotes, entities, documents, embeddings, signals,
briefings, notifications, priorities, llm_usage, users). Re-runnable.

Verify in the Neon SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

You should see 12 tables.

### Optional: seed sample data

```bash
npm run seed
```

Inserts ~15 realistic envelopes spanning all 8 modules (Aurora Bank deal,
Meridian Trust health risk, Liberty Federal Blue Prism competitive, FedRAMP
initiative blocker, NYDFS regulatory mention, etc.) so the dashboards
populate immediately. Idempotent — safe to re-run. Detectors only fire if
Inngest is also processing events; see the script's final note.

---

## 3. Provision Vercel + Inngest

### Vercel

1. Create a new Vercel project from the GitHub repo `ebleck55/admin-work`.
2. **Deploy production from branch:** `main` (your call — you can keep
   `claude/affectionate-pascal-bpUWZ` as the deploy branch until the first PR
   merges).
3. Enable [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) and grab
   a read/write token for `BLOB_READ_WRITE_TOKEN`.
4. **Don't enable Vercel password protection yet** — wait until env vars are
   set and the smoke test passes, otherwise you'll fight the protection page
   while testing.

### Inngest

1. Create an Inngest app named `chief-of-staff`.
2. From the **Manage → Signing Keys** page, copy:
   - `INNGEST_EVENT_KEY`
   - `INNGEST_SIGNING_KEY`
3. Once Vercel deploys, add the deployed URL `/api/inngest` as the **Sync URL**
   in Inngest's dashboard. Inngest will probe it and discover the registered
   functions.

---

## 4. Configure environment variables

In **Vercel → Settings → Environment Variables**, set (all environments):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `ANTHROPIC_API_KEY` | Anthropic console → API keys |
| `GEMINI_API_KEY` | Google AI Studio → API keys (used for embeddings + LLM fallback) |
| `OPENAI_API_KEY` | _(optional — only set if you re-introduce OpenAI calls)_ |
| `GOOGLE_TTS_API_KEY` | GCP API key restricted to Text-to-Speech |
| `COS_INGEST_TOKEN` | Generate: `openssl rand -base64 32` |
| `CRON_SECRET` | Generate: `openssl rand -base64 32` |
| `BLOB_READ_WRITE_TOKEN` | From Vercel Blob |
| `INNGEST_EVENT_KEY` | From Inngest |
| `INNGEST_SIGNING_KEY` | From Inngest |
| `SENTRY_DSN` | _(optional)_ |

Redeploy after setting env vars (Vercel does this automatically on env change).

---

## 5. Configure the Vercel Cron secret header

Vercel Cron invocations need an `Authorization: Bearer ${CRON_SECRET}` header.
In Vercel:

1. **Settings → Cron Jobs** — you should see `/api/cron/preload` at `0 11 * * *`
   (6am EST, from `vercel.json`).
2. Vercel passes the `CRON_SECRET` header automatically when set as an env var.

---

## 6. Smoke test

Once deploy is green:

```bash
# Replace with the actual prod URL and your token
URL="https://chief-of-staff.vercel.app"
TOKEN="<your COS_INGEST_TOKEN>"

# Health check
curl -i $URL/api/health
# → 200 { ok: true, checks: { database: { ok: true } } }

# Ingest a sample envelope
curl -i -X POST $URL/api/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @sample-envelope.json
# → 200 { ledger_id, claims: 2, entities: 2, redactions: [] }

# Verify rows landed
# (Neon SQL Editor:)
SELECT count(*) FROM evidence_ledger;   -- should be 1
SELECT count(*) FROM claims;            -- 2
SELECT count(*) FROM entities;          -- 2
SELECT count(*) FROM signals;           -- 1+ if any detector matched
```

Then open the deployed URL in a browser and walk through:
- `/` — home with module tiles, Ask/Briefings/Notifications/Status quick links
- `/pipeline` — recent signals + opportunities
- `/ask` — Q&A console (try "What's in the evidence ledger?")
- `/briefings` — today's briefing should auto-trigger
- `/status` — table counts + LLM cost snapshot

---

## 7. Connect OpenAI Codex (primary extraction path)

Eric's Codex prompts live in `playbooks/`. To run one:

1. Open Codex authenticated as `eric.bouchard@uipath.com`.
2. Paste the playbook prompt (e.g., `playbooks/outlook-email/daily-customer-followups.md`).
3. Replace `$COS_URL` and `$COS_INGEST_TOKEN` with your real values.
4. Codex pulls from its connectors, formats canonical envelopes, and POSTs
   directly to `/api/ingest`. Each row in `evidence_ledger` corresponds to
   one Outlook thread / Slack message / Zoom transcript / etc.

---

## 8. Set up the Mac sync agent (fallback path)

On Eric's Mac, the sync agent watches `~/Desktop/chief of staff app/` for
Salesforce CSV exports and any other files dropped there.

```bash
git clone https://github.com/ebleck55/admin-work.git
cd admin-work
mkdir -p ~/Desktop/"chief of staff app"

export COS_URL="https://chief-of-staff.vercel.app"
export COS_INGEST_TOKEN="<your token>"
node scripts/sync-agent/index.mjs
```

To run on login, install the launchd plist from
`scripts/sync-agent/README.md`.

To test it: export a Salesforce pipeline report as CSV per the spec in
`playbooks/salesforce/pipeline-csv-format.md`, drop it in the watched
folder, and watch the agent log "uploaded" and move it to `_uploaded/`.

---

## 9. Enable password protection

Once smoke tests pass, in Vercel **Settings → Deployment Protection**, enable
"Password Protection" and choose a strong password. Eric will hit a Vercel
SSO page on every browser visit; Codex's `/api/ingest` POSTs are not affected
because they're bearer-token authenticated separately.

---

## 10. What ships today vs. what's later

**Today (Phase 0-5 in the prototype):**
- Canonical envelope ingestion (Codex direct webhook + Mac sync agent fallback)
- Evidence ledger + append-only writes + PII redaction at boundary
- 8 modules with heuristic detectors and dashboards
- pgvector RAG + Q&A console with evidence citations
- Daily briefings (Opus 4.7) with audio (Google Cloud TTS, Chirp3-HD chain)
- In-app notification feed
- Cross-module priority ranking
- LLM cost tracking, circuit breaker, fallback chain, prompt caching

**Later (Phase 6+):**
- Multi-user (Auth.js); right now everything is solo Eric
- Smarter detectors layering Sonnet 4.6 on top of heuristics
- Per-artifact comms drafts (board prep, talking points)
- Real-time push notifications (browser Web Push)
- Optional Slack bot if Eric wants proactive Slack DMs
- Optional email digest (Resend)
- Direct Microsoft Graph / Slack / Zoom APIs to replace Codex extraction at scale
