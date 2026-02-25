# Daily Update Pipeline

The daily update script (`scripts/dailyUpdate.js`) refreshes all note and note status data from the public Community Notes dataset, preserves previously looked-up author handles, and discovers handles for new notes via the X API.

## How to Run

```bash
node scripts/dailyUpdate.js
```

The date is auto-detected. The script determines the current date in PST, probes the Community Notes dataset with a HEAD request, and falls back up to 3 previous days if the data isn't available yet (HTTP 404). No manual date editing is needed.

## Pipeline Steps

### Step 1: Resolve Date & Download Data (`downloadNewData.js`)

Resolves the latest available dataset date by probing from today (PST) backward up to 3 days, then dynamically discovers how many files exist for each type by sending HEAD requests starting at index `00000` and incrementing until a 404 is returned. Downloads all discovered ZIP files and extracts the TSVs.

File types discovered:

- `notes-{NNNNN}.zip` — community notes (currently 2 files, ~1.1 GB + ~1.4 MB)
- `noteStatusHistory-{NNNNN}.zip` — status history (currently 1 file, ~650 MB)

Source URL pattern: `https://ton.twimg.com/birdwatch-public-data/{YYYY/MM/DD}/{prefix}/{prefix}-{NNNNN}.zip`

After extraction, the ZIP files are deleted. The TSVs are saved to the `tsv/` directory. The list of downloaded file paths is returned to the pipeline so no filenames are hardcoded.

### Step 2: Verify Downloads

Before any database table is touched, all downloaded TSV files are checked for existence and non-zero size. If any file is missing or empty, the pipeline halts immediately.

### Step 3: Update Note Status Table (`updateNoteStatusTable.js`)

Truncates the `note_status` table and reloads it from all discovered `noteStatusHistory-*.tsv` files. Accepts a single path or an array. This contains the current status (e.g. `CURRENTLY_RATED_HELPFUL`) for every note.

### Step 4: Backup Handles (`backupHandles.js`)

Before the notes table is touched, all existing `noteId → handle` mappings are exported from the `notes` table to `tsv/handlesBackup.tsv`. This preserves handles that were previously looked up via the X API, since the downloaded TSV files do not include handle data.

The backup file is verified for existence and non-zero size before proceeding.

### Step 5: Reload Notes Backup Table (`updateNoteBackupTable.js`)

Truncates the `notes_backup` staging table and reloads it from all discovered `notes-*.tsv` files. At this point, all `handle` values in `notes_backup` are NULL.

### Step 6: Restore Handles (`updateHandlesFromBackup.js`)

Reads the backup file from Step 4 and restores handles into `notes_backup` using batched SQL UPDATE queries (5,000 rows per query).

### Step 7: Replace Notes Table (`updateNoteTable.js`)

Truncates the live `notes` table and copies all data from `notes_backup` into it. After this step, `notes` has the latest data with handles preserved.

### Step 8: Add Handles for New Notes (`addHandlesApi.js`)

Queries the `notes` table for notes where `handle IS NULL` and `currentStatus = 'CURRENTLY_RATED_HELPFUL'`, then looks up the tweet author via the X API (`GET /2/tweets` with `expansions=author_id`).

- Batches up to 100 tweet IDs per API request
- Handles are stored with `@` prefix (e.g. `@username`)
- Rate limit handling with automatic retry on 429 responses

### Cleanup

Deletes all downloaded TSV files (notes and status history). The handle backup file is intentionally kept as a safety net.

## Safety Mechanisms

- **File verification**: Downloaded files and the handle backup are verified before any truncation
- **Error propagation**: All sub-scripts re-throw errors so the pipeline halts on failure
- **Handle preservation**: Handles are backed up to disk before any table is modified
- **Memory efficiency**: Bulk inserts use `{ returning: false }` and process in batches to avoid OOM

## Database Tables Affected

| Table | Action |
|---|---|
| `note_status` | Truncated and reloaded |
| `notes_backup` | Truncated, reloaded, handles restored |
| `notes` | Truncated and replaced from `notes_backup` |

## Standalone Scripts

These scripts can be run independently outside the daily update:

- **`addUsers.js`** — Creates `User` records for the top 250 note authors by note count
- **`addUserInfoApi.js`** — Fetches user profile info (name, bio, followers, etc.) from the X API for users missing that data. Supports `--overwrite` to refresh all users and `--limit=N` to control how many
- **`testConnection.js`** — Tests database connection and prints row counts for all tables
