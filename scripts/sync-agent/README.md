# Sync agent

Watches `~/Desktop/chief of staff app/` on Eric's Mac. Uploads any new file to `/api/ingest` and moves the original into a sibling `_uploaded/` folder.

Used as the **fallback** ingestion path; the primary path is OpenAI Codex POSTing canonical envelopes directly. The sync agent covers the manual Salesforce CSV export flow and any other case where Eric drops a file from his desktop.

## Run

```bash
node scripts/sync-agent/index.mjs
```

## launchd (auto-start on login)

Create `~/Library/LaunchAgents/com.cos.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.cos.sync</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/node</string>
      <string>/Users/eric/code/admin-work/scripts/sync-agent/index.mjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>COS_URL</key><string>https://cos.example.com</string>
      <key>COS_INGEST_TOKEN</key><string>...</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/cos-sync.out.log</string>
    <key>StandardErrorPath</key><string>/tmp/cos-sync.err.log</string>
  </dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.cos.sync.plist`.

## File handling

- `*.json` files are POSTed as-is (assumed to be canonical envelopes).
- `*.csv` files matching the Salesforce export shape are translated to envelopes via `lib/ingestion/source-adapters/salesforce-csv.ts` (Phase 1 — sync agent for CSV is a stub for now and logs "not yet supported").
- Anything else is logged and left in place.

Uploaded files are moved to `_uploaded/<YYYY-MM-DD>/` so the watch folder stays clean.
