# Salesforce pipeline CSV format

Codex cannot reach Salesforce, so Eric exports pipeline data manually.

## Steps for Eric

1. In Salesforce, run the report **"FS GTM — Open Pipeline (Full)"** (or your equivalent).
2. Export as **Comma Separated Values (.csv)**, encoding **UTF-8**, columns set per below.
3. Save into `~/Desktop/chief of staff app/` with filename `sf-pipeline-YYYY-MM-DD.csv`.
4. The sync agent (running via launchd) detects the file, runs the CSV→envelope adapter, and POSTs each row as a payload to `/api/ingest`.

## Expected columns (case-insensitive headers)

| Column | Required | Notes |
|---|---|---|
| `Opportunity ID` | ✅ | Used as `source_id` and `entities[].external_id`. |
| `Opportunity Name` | ✅ | Used as `entities[kind=opportunity].name`. |
| `Account Name` | ✅ | Used as `entities[kind=account].name`. |
| `Account ID` |  | Used as the account's `external_id` if present. |
| `Stage` | ✅ | Emitted as a `claim` with module_id=pipeline. |
| `Amount` | ✅ | Emitted as a `claim`. |
| `Close Date` | ✅ | Emitted as a `claim`; the most recent file's date is the `source_timestamp`. |
| `Probability` |  | Maps to claim `confidence` if present, else default 0.7. |
| `Owner` |  | Maps to `actor` and `entities[kind=rep].name`. |
| `Last Activity Date` |  | Emitted as a `claim`. |
| `Next Step` |  | Emitted as a `claim`. |
| `Forecast Category` |  | Emitted as a claim attribute. |

## Sensitivity

All Salesforce export rows default to `sensitivity: "internal"`. Override per-row by adding an `Internal Only` column with value `Yes` to bump to `private_dm` (rare; usually unset).

## One row = one envelope

The adapter emits one envelope per row, with multiple claims (one per non-empty Salesforce field). This keeps the evidence ledger granular: a deal that changed stage will produce a distinct claim from one that changed amount, even though both came from the same CSV row.
