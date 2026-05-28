# Playbooks

These are markdown prompts Eric runs in OpenAI Codex. Each one tells Codex what to pull from its connectors, how to structure the result, and how to POST it to the app.

Codex authenticates as `eric.bouchard@uipath.com` and has read access to Outlook Email, Outlook Calendar, UiPath Slack (including DMs — gated by the `sensitivity` field), and UiPath Zoom. Salesforce is NOT in Codex; that data flows via CSV export through the Mac sync agent.

## Conventions

- Every payload conforms to the canonical envelope (`lib/ingestion/envelope.ts`).
- Codex POSTs the payload directly:
  ```bash
  curl -X POST $COS_URL/api/ingest \
    -H "Authorization: Bearer $COS_INGEST_TOKEN" \
    -H "Content-Type: application/json" \
    -d @payload.json
  ```
- Slack DM + group-DM content **must** carry `sensitivity: "private_dm"`. Codex sets this when the source channel is a DM.
- Each claim cites at least one quote in the `evidence` array via `claim_index`.

## Directory layout

```
playbooks/
├── outlook-email/
├── outlook-calendar/
├── slack/
├── zoom/
└── salesforce/
```

Each subdirectory holds one playbook per cadence (daily / weekly / adhoc). See individual files for the full prompt + expected schema reference.
