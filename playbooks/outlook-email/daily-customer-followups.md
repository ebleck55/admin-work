# daily-customer-followups

**Cadence:** Daily, morning (Eric runs in Codex before opening the dashboard).
**Source system:** `outlook_email`
**Default sensitivity:** `internal`

## Prompt to Codex

> For each customer-facing email thread in my Outlook inbox that received any activity in the last 24 hours (filter on `received` >= yesterday 00:00 UTC), extract:
>
> 1. The sender (or last responder), the customer account (best guess from the email domain or signature), and the subject.
> 2. Any **commitment** I (Eric) or my team made (e.g., "we'll deliver the SOC 2 letter by Friday").
> 3. Any **escalation** signal — language like "still waiting", "missed the deadline", "concerned", "blocker".
> 4. Any **regulatory or competitive** mention (FedRAMP, SOC 2, ISO 27001, AML/BSA, competitor names: Salesforce, Microsoft, Pega, Automation Anywhere, Blue Prism).
>
> Produce one canonical-envelope payload per email thread, with:
>
> - `source_system: "outlook_email"`
> - `source_id`: the Outlook message ID of the most recent message in the thread
> - `source_url`: the Outlook web link to the thread
> - `collected_at`: now (ISO 8601 UTC)
> - `source_timestamp`: the timestamp of the most recent message
> - `actor`: the most recent sender's email
> - `sensitivity`: `"internal"`
> - `entities`: one `account` entity per inferred customer; one `contact` entity per non-Eric participant
> - `claims`: one claim per commitment / escalation / regulatory / competitive observation, with `module_id` set appropriately (`pipeline`, `cs`, `finserv`, or `competitive`) and `confidence` between 0.5 and 0.95
> - `evidence`: one verbatim quote per claim, citing the email line it came from
> - `raw_text`: the full plain-text body of the thread (most recent message first)
> - `title`: a 3-7 word summary of the thread
>
> Then POST each payload:
>
> ```bash
> curl -X POST $COS_URL/api/ingest \
>   -H "Authorization: Bearer $COS_INGEST_TOKEN" \
>   -H "Content-Type: application/json" \
>   -d @payload.json
> ```
>
> Continue until every active thread from the last 24h is uploaded. Skip threads with only auto-generated content (DocuSign envelopes, calendar invites, etc.) — these are noise.

## Expected output

10-40 envelopes on a normal day. Each maps to one row in `evidence_ledger`, 1-5 claims, 1-5 evidence quotes, and a denormalized `documents` row for embedding.
