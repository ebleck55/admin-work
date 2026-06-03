# Good morning — here's what changed and what you need to do

Everything below is on the branch `claude/chief-of-staff-review-PxLA8` in a **draft PR**.
Nothing is live yet. You merge when you're happy. Reviewed bottom-up: do the **Your steps**
section first (≈15 min), then merge.

---

## The one thing that matters most
Your app was reachable on the public internet with **no login** on the chat, memory, and most
other routes — anyone with the URL could read (and poison) real customer data, including
private DMs. The fix for that is a setting **you** turn on in Vercel (Password Protection).
The code changes here make everything else robust *around* that gate and make sure turning it
on doesn't break your data pipeline.

---

## Your steps (do these in order)

### 1. Lock the front door (5 min) — the critical one
1. Vercel → your project → **Settings → Deployment Protection**.
2. Turn on **Password Protection** (Pro plan) for Production. Set a password only you know.
3. Still on that page, under **Protection Bypass for Automation**, click **Generate Secret**
   and copy it.

### 2. Add three env vars in Vercel (5 min)
Vercel → Settings → Environment Variables (Production):
| Variable | Value |
|---|---|
| `VERCEL_AUTOMATION_BYPASS_SECRET` | the bypass secret you just generated |
| `COS_DAILY_USD_CAP` | `50` (or whatever daily LLM ceiling you want) |

### 3. Keep your data pipeline alive past the gate (5 min)
Password Protection blocks *everything*, including the machines that feed the app. Handle each:
- **Sync agent** (the Mac script): set `VERCEL_AUTOMATION_BYPASS_SECRET` in its environment to
  the same secret. It now sends that header automatically — no other change.
- **Codex ingest connectors** (Outlook/Slack/Zoom → `/api/ingest`): add the request header
  `x-vercel-protection-bypass: <secret>` to their POST config.
- **Inngest**: in the Inngest dashboard, set your app's serve URL to include the bypass query
  params: `https://<your-domain>/api/inngest?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`,
  then re-sync. (If Inngest functions stop running after you enable the gate, this is why.)
- **Vercel Cron**: nothing to do — Vercel Cron bypasses Deployment Protection automatically.

### 4. Merge the PR
Review the draft PR, then merge to deploy. CI (typecheck + tests + build) is green.

### 5. Smoke-test live (10 min, after deploy)
Run these against the deployed app (all should still work *because* of step 3):
```bash
# Ingest still works through the gate (expects 200 + a ledger id):
curl -X POST https://<domain>/api/ingest \
  -H "Authorization: Bearer $COS_INGEST_TOKEN" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  -H "Content-Type: application/json" -d @sample-envelope.json

# The UI now asks for the Vercel password before loading any page.
# In the browser, after logging in: open a chat, ask a question — you should get a grounded
# answer; ask something with no evidence — it should say "no evidence on file" (not make
# something up).
```
Then: trigger a briefing (or wait for the noon cron) and confirm that if it contains an
unverified figure, you see an **"⚠️ Unverified claims"** footer at the bottom.

---

## What changed in the code (plain English)

**Security & data isolation**
- **Injection defense:** all third-party content (emails, Slack, Zoom, CRM) is now wrapped as
  clearly-labeled *untrusted data* before it reaches the model, with rules telling the model
  never to obey instructions hidden inside it. A crafted email can no longer tell your
  assistant to "set the deal to $5M."
- **Private-DM leak guard:** the safety check that was written but never actually wired in is
  now enforced — briefings drop any private-DM content before they're generated, fail-closed.
- **No-fabrication-on-empty:** if a question has no supporting evidence, the assistant now says
  so instead of answering from general knowledge.
- **Audit trail:** every time private-DM content is surfaced, it's logged.

**Trustworthy output**
- **Fact-verification pass:** briefings are now checked, claim by claim, against their source
  evidence; any number/quote/date that isn't supported gets flagged in an "Unverified claims"
  footer so you confirm before forwarding.

**Reliability & cost**
- **Real spend cap:** every LLM call is now recorded to the database and a rolling 24-hour
  budget is enforced (`COS_DAILY_USD_CAP`). Background jobs pause at the cap; interactive chat
  keeps working but alerts at 50/80/100%. (Previously cost tracking reset on every cold start
  and capped nothing.)
- Internal error messages are no longer leaked to the browser in the chat stream.

**New capability — "Movers"**
- A new **/movers** page (linked from the home nav) ranks accounts whose health scores moved
  the *wrong way* week-over-week, with a one-line "so-what" and a "Draft the play" button.
  It surfaces *change*, not just bad absolute scores.

---

## Honest caveats (please read)
- I built and verified all of this with **type-checks, the test suite (57 tests, all passing),
  a production build, and lint** — but this environment had **no database or API keys**, so I
  could **not** run it against your live data. Step 5's smoke tests are how we confirm the real
  behavior. Watch the first briefing and the first ingest after you flip the gate.
- **Durable rate-limiting / circuit-breaking across serverless instances** is *not* in this PR.
  The honest reason: doing it right needs a shared store (Vercel KV / Upstash) that I can't
  provision or test from here, and a half-built version risks breaking all requests. The
  **daily budget cap is the real cost guardrail** and it *is* in. If you want distributed rate
  limiting, that's a small follow-up once you add a KV store — say the word.
- **Provenance click-through** (every citation linking to its source) is partially there — the
  data is already exposed to the UI — but I did not rebuild the chat components to render it as
  links, since I couldn't test UI changes live. Flagged as a follow-up.

Full technical plan: `/root/.claude/plans/woolly-giggling-puffin.md` (in the planning env).
