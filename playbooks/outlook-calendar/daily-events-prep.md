# Outlook Calendar — daily events sync

Paste this into a new OpenAI Codex chat (authorized against the
`eric.bouchard@uipath.com` Microsoft connector). Schedule it to run daily
at **5:30 AM Central** alongside the other COS playbooks.

---

For every meeting on my Outlook calendar in the next 5 days
(`start >= now AND start <= now + 5 days`), produce one canonical envelope
payload per event:

```json
{
  "source_system": "outlook_calendar",
  "source_id": "<Outlook event ID>",
  "source_url": "<deeplink to the Outlook event>",
  "collected_at": "<now ISO 8601 UTC>",
  "source_timestamp": "<event start ISO 8601 UTC>",
  "actor": "<organizer email>",
  "sensitivity": "internal",
  "entities": [
    { "kind": "account", "name": "<inferred customer if external attendees>" },
    { "kind": "contact", "name": "<each non-Eric external attendee>" },
    { "kind": "rep", "name": "<each non-Eric UiPath attendee>" }
  ],
  "claims": [
    {
      "statement": "<one-sentence summary of meeting purpose>",
      "module_id": "pipeline",
      "confidence": 0.6
    }
  ],
  "confidence": 0.7,
  "title": "<event title>",
  "raw_text": "<event body / agenda if non-trivial; otherwise omit>",
  "attributes": {
    "calendar_event": {
      "start_at": "<ISO 8601>",
      "end_at": "<ISO 8601>",
      "attendees": [
        { "email": "<email>", "name": "<display>", "is_self": false }
      ],
      "location": "<location or video URL or null>",
      "description": "<full event body>"
    }
  }
}
```

Then POST each one to:

```bash
curl -X POST https://admin-work-five.vercel.app/api/ingest \
  -H "Authorization: Bearer 6LVCYm8Kn69bQ8iUG2IkgMPD+PtxTQ/0o8YaDgmU/OE=" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

Skip recurring weekly 1:1s with people I meet with 4+ times per month
(those are routine; the app gets prep value from the higher-stakes events).
Skip all-day blocks and out-of-office events.

When done, give me a summary: number of events uploaded, any events where
attendee → account attribution was uncertain.
