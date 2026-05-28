# Chief of Staff

A web app that synthesizes GTM intelligence across Outlook, Calendar, Slack, Zoom, and Salesforce into one evidence-grounded view: pipeline, customer success, team performance, strategic initiatives, FinServ vertical intel, competitive intel, a unified priority feed, and exec communications.

## Architecture

- **Extraction layer (outside the app):** OpenAI Codex connectors pull from Outlook / Calendar / Slack / Zoom and POST canonical-envelope payloads to `/api/ingest`. Salesforce data is exported manually as CSV into `~/Desktop/chief of staff app/` and uploaded by a sync agent.
- **Evidence ledger:** Every ingested payload is written append-only to `evidence_ledger`. Every downstream claim, signal, briefing, and answer cites back to it.
- **Processing:** Inngest durable jobs classify, extract claims, resolve entities, embed for pgvector search, detect signals, and apply sensitivity gating.
- **Intelligence:** Briefings (Opus 4.7), in-app alerts, Q&A (RAG with citations), Google Cloud TTS audio briefings.
- **Delivery (day 1):** Web app only — dashboard, briefing archive, Q&A console, audio player, in-app notification feed.

## Stack

Next.js 15 (App Router) · TypeScript · Drizzle ORM · Neon Postgres + pgvector · Inngest · Vercel Cron · Anthropic SDK · Google Generative AI SDK · OpenAI SDK (embeddings) · Google Cloud TTS REST · Tailwind · Zod · Vitest.

## Plan

The implementation plan lives at `/root/.claude/plans/chief-of-staff-delegated-sphinx.md` (planning environment) and is the source of truth for module contracts, the canonical payload envelope, and the reuse maps for the Bart and Learning Quest patterns this codebase ports.

## Local development

```bash
npm install
cp .env.example .env.local      # fill in keys
npm run db:push                 # create schema in Neon dev branch
npm run dev                     # http://localhost:3000
npm run inngest:dev             # separate terminal — Inngest dev server
```

## Ingesting a payload (smoke test)

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $COS_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @sample-envelope.json
```
