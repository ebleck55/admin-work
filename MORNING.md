# Good morning — here's what changed and what you need to do

Everything below is on branch `claude/chief-of-staff-review-PxLA8` in a **draft PR**. Nothing
is live until you merge. Do the **Your steps** section first (≈5 min), then merge.

> Update: the front door is now a **built-in login page** (no Vercel Pro needed). The earlier
> Vercel Password Protection plan was dropped.

---

## The one thing that matters most
Your app was reachable on the public internet with **no login** on chat, memory, and most
routes — anyone with the URL could read (and poison) real customer data, including private DMs.
This PR adds a real login gate **in the app itself**: a `/login` page + a signed session cookie
enforced on every route by middleware. Your data-pipeline endpoints (`/api/ingest`,
`/api/inngest`, `/api/cron`, `/api/health`) are exempt because they already authenticate with
their own secrets — so turning this on does **not** break ingestion.

---

## Your steps (do these in order)

### 1. Add two env vars in Vercel (3 min) — the critical one
Vercel → your project → **Settings → Environment Variables** (Production):

| Variable | Value |
|---|---|
| `COS_APP_PASSWORD` | the password you'll type to sign in — make it long |
| `COS_SESSION_SECRET` | run `openssl rand -base64 32` and paste the output |

Optional (cost guard): `COS_DAILY_USD_CAP` = `50` (or your preferred daily LLM ceiling).

> If `COS_SESSION_SECRET` is missing in production, the app **fails closed** (503 on every
> page) rather than serving data unauthenticated — so don't skip this.

### 2. Merge the PR
Review draft PR #2, then merge to deploy. (Confirm the GitHub Actions `build` check is green
first — see the note at the bottom.)

### 3. Smoke-test live (5 min, after deploy)
- Visit the app → you should be redirected to **`/login`**. Enter `COS_APP_PASSWORD` → you land
  on the dashboard. A wrong password is rejected (and throttled after ~10 tries/min).
- Confirm ingestion still works (it's exempt from the gate):
  ```bash
  curl -X POST https://<domain>/api/ingest \
    -H "Authorization: Bearer $COS_INGEST_TOKEN" \
    -H "Content-Type: application/json" -d @sample-envelope.json
  ```
  Expect `200` + a ledger id. If Inngest functions stop running, check the Inngest dashboard is
  still pointed at `/api/inngest` (no change needed — it's exempt).
- In a chat: ask a question → grounded answer. Ask something with no evidence → it should say
  **"no evidence on file"** (not invent an answer).
- Trigger a briefing (or wait for the noon cron); if it contains an unsupported figure you'll
  see an **"⚠️ Unverified claims"** footer.

There is no separate "log out" button in the UI yet, but `POST /api/auth/logout` clears the
session if you ever need it.

---

## What changed in the code (plain English)

**Front door (new)**
- Built-in **login gate**: `/login` page + signed HttpOnly session cookie, enforced on every
  page and API route by `middleware.ts`. Machine endpoints stay reachable via their own secrets.
  Login attempts are rate-limited.

**Security & data isolation**
- **Injection defense:** all third-party content (email, Slack, Zoom, CRM) is wrapped as
  labeled *untrusted data* with rules telling the model never to obey instructions hidden in it.
- **Private-DM leak guard:** the safety check that was written but never wired in is now
  enforced — briefings drop private-DM content before generation, fail-closed.
- **No-fabrication-on-empty:** with no supporting evidence, the assistant says so instead of
  guessing from general knowledge.
- **Audit trail:** every time private-DM content is surfaced, it's logged.

**Trustworthy output**
- **Fact-verification pass:** briefings are checked claim-by-claim against their evidence; any
  unsupported number/quote/date is flagged in an "Unverified claims" footer.

**Reliability & cost**
- **Real spend cap:** every LLM call is recorded to the DB and a rolling 24h budget is enforced
  (`COS_DAILY_USD_CAP`), with 50/80/100% alerts. (Previously cost tracking reset on every cold
  start and capped nothing.)
- Internal error messages are no longer leaked to the browser in the chat stream.

**New capability — "Movers"**
- A new **/movers** page (linked from home) ranks accounts whose health scores moved the *wrong*
  way week-over-week, with a one-line "so-what" and a "draft the play" button.

---

## Honest caveats (please read)
- Verified with **type-checks, the test suite (63 tests, all passing), a production build, and
  lint** — but this environment had **no database or API keys**, so it was **not** run against
  your live data. Step 3 is how we confirm real behavior.
- The session cookie is `SameSite=Lax` + `HttpOnly` + `Secure` (in prod). Good for a single-user
  app. If you later add more users or want SSO, that's a bigger change (Auth.js) — not needed now.
- **Distributed rate-limiting / circuit-breaking** across serverless instances is *not* in this
  PR (needs a shared store like Vercel KV; a half-built version risks breaking all requests). The
  **daily budget cap is the real cost guardrail** and it *is* in. The login throttle is
  best-effort per-instance.
- **Provenance click-through** (citations linking to source) is partial — the data is exposed to
  the UI but the chat components weren't rebuilt to render links, since UI changes couldn't be
  tested live.

---

### Note on CI
The GitHub Actions `build` check (typecheck + tests + build) runs on the PR. Confirm it's green
before merging — I'll have flagged here if it came back red.

Full technical plan: `/root/.claude/plans/woolly-giggling-puffin.md` (planning env).
