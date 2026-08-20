---
name: otter-journal-scanner
description: Sync Otter.ai meeting transcripts directly into the Workflowy calendar, skipping meetings already logged. Invoked by /gtd:journal and the daily-review /gtd:otter-journal-auto task.
color: cyan
skills:
    - calendar-dates
    - workflowy-html
---

This journal agent ingests Otter.ai meetings into the Workflowy journal at the root Calendar node.

**Important:** Entries are intentionally created as direct children of `📆 Calendar`, not under date sub-nodes. Workflowy has built-in functionality to auto-sort calendar entries into the correct date positions — the user runs this manually. So don't find or create date nodes; just create entries at the Calendar root.

Uses the Otter API directly via `${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh` with cursor-based pagination for efficient resumable syncs.

## Modes

This agent runs in one of two modes; the invoking command sets it, and the default is `create`.

- **`create` (default)** — manual `/gtd:journal` runs and the daily-review `/gtd:otter-journal-auto` (`🤖 Auto`) task. Scan, create entries under `📆 Calendar` inline, and advance the live scanner state after each page (see **Save State**). This is the legacy behavior described throughout the rest of this doc.
- **`stage`** — _(currently unused)_ a read-only staging mode: compute exactly what `create` mode would create, but make **zero** Workflowy writes — stage the entries as proposal `applyOps` and emit the next scanner state as a top-level `scannerState` block, then stop. It backed the former staged prep/apply split, which was replaced by the `🤖 Auto` `/gtd:otter-journal-auto` task (create mode). Retained for any future confirm-before-create flow. See **Staging Mode** below.

**Load State** through **Process Meetings** run identically in both modes (load state read-only, refresh the dedup cache, scan, dedup). The modes diverge only at the **Create node** and **Save State** steps.

## API Script

The script `${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh` handles authentication and provides:

```bash
# Recommended: Minimal JSON with action items inlined (for sync)
${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh sync [page_size] [cursor] [modified_after]

# Raw endpoints (if needed):
${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh available_speeches [page_size] [cursor] [modified_after]
${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh action_items <otid>
```

The `sync` command returns minimal JSON with:

- `otid`, `title`, `start_time`, `summary`, `outline`
- `action_items` array inlined (fetched automatically for processed meetings)

**Required environment variables:** `OTTER_USERNAME`, `OTTER_PASSWORD`

## State Storage

Sync state is stored under `Metadata > ⚙️ Scanner State > otter-journal-scanner` as a JSON child node:

```json
{
	"cursor": "1762808594",
	"session_start": 1736283600,
	"last_synced_otid": "abc123",
	"reached_beginning": false
}
```

## Process Overview

- Load state from Workflowy
- Determine scope (first run: ask user how far back; subsequent: incremental from cursor)
- Fetch page of meetings via `available_speeches` with cursor
- Process meetings (oldest first) until hitting `last_synced_otid` or scope boundary
- Save state after each page
- Continue until caught up or `end_of_list: true`

## Load State

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

```bash
./bin/run.js node get --path "Metadata,⚙️ Scanner State,otter-journal-scanner" --depth 1 --json --fields id,name,children 2>/dev/null
```

If path doesn't exist (first run), state is empty. Parse JSON from first child's name if it exists.

## Determine Scope

**If state exists with `last_synced_otid`:** This is an incremental sync. Sync only meetings newer than the cursor. Skip to Initialize Session.

**If first run (no state):** Don't fetch all meetings — that risks an unbounded scan of hundreds of meetings. Instead:

- Use `AskUserQuestion` to ask the user how far back to sync (e.g., "Last 2 weeks", "Last month", "Since January 2026", "All meetings")
- Convert their answer to a Unix timestamp for the `modified_after` parameter
- This prevents unbounded scans of potentially hundreds of meetings

**In `stage` mode, never call `AskUserQuestion`.** A first run (no state) has no autonomous scope to pick, so stage `status: "needs-interactive"` and stop. (Stage mode is currently unused; the daily review's Otter ingestion runs in `create` mode via the `🤖 Auto` `/gtd:otter-journal-auto` task, and a manual `/gtd:journal` run can seed state interactively in `create` mode.)

## Initialize Session

Set `session_start` to current Unix timestamp: `$(date +%s)` This becomes the constant `modified_after` value for all pages in this sync session.

## Refresh Destination Cache

The URL-dedup check in **Process Meetings** reads the local SQLite cache. By the time this scanner runs, that cache is stale for the Calendar subtree (the daily import runs earlier, and other tasks modify the calendar after it), so existing meetings look new and get re-created. This is the historical cause of duplicate meetings.

Before processing any meetings, sync the Calendar's direct children so the dedup search reflects what is already in Workflowy. Use a **non-recursive** sync — new meetings are created as flat direct children of `📆 Calendar` (see above), so the direct-children level is the only scope the dedup needs. It refreshes all direct children in well under a second; a `--recursive` sync of the full year/month archive takes minutes and locks the cache against the scanner's own reads.

```bash
./bin/run.js cache sync-node --path "📆 Calendar"
```

Then reset the in-session guard, which catches the case the cache cannot — a meeting this same run already created on an earlier page (same-session creates are not visible to the search until the next sync):

```bash
mkdir -p .llm/gtd/journal/logs
: > .llm/gtd/journal/logs/otter-created-this-session.txt
```

## Fetch Page

Use page_size=1000 (max tested; 1200 works but 1250+ times out with 504).

```bash
# Page 1 (no cursor)
${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh available_speeches 1000

# Page 2+ (with cursor and modified_after)
${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh available_speeches 1000 "$CURSOR" "$SESSION_START"
```

Parse response for:

- `speeches[]` - array of meetings
- `last_load_ts` - cursor for next page
- `end_of_list` - true when no more pages

## Process Meetings

For each meeting in page (process oldest first to maintain calendar order):

**Check if already synced (cursor):** If `otid == last_synced_otid`, stop - we've caught up to previous sync.

**Check if created earlier this session (in-run guard):** If `<otid>` is already in the session guard file, skip — this run created it on an earlier page, and the cache cannot reflect same-session creates:

```bash
grep -qF "<otid>" .llm/gtd/journal/logs/otter-created-this-session.txt && echo "skip: created this session"
```

**Check if already exists (URL dedup):** Even if the cursor check passes, verify the meeting doesn't already exist in the calendar. This search reads the local cache, which was refreshed in **Refresh Destination Cache** above so it reflects meetings already in Workflowy:

```bash
./bin/run.js node search --query "otter.ai/u/<otid>" --limit 1 --json
```

If any result is returned, skip this meeting — it was already created (e.g., from a previous sync or manual entry).

**Log the dedup decision:**

```bash
mkdir -p .llm/gtd/journal/logs
echo "[$(date -Iseconds)] otid=<otid> search_result=<found|not_found> action=<created|skipped>" >> .llm/gtd/journal/logs/otter-sync.log
```

**Check if ready:** Skip if `summary` is null (still processing).

**Use sync command output directly:** The `sync` command returns all needed data in minimal JSON:

- `summary` - the narrative overview
- `outline[]` - sections with titles and segments
- `action_items[]` - with `text`, `assignee`, `completed` (auto-fetched)

**Build entry:**

Convert Unix timestamp to Workflowy date (see **calendar-dates** skill).

The entry name has three parts: `<time>` tag, then title wrapped in `<a href>` linking to the Otter URL, then `#meeting`. Encode quotes in titles as `&quot;`.

```json
{
  "name": "<time startYear=\"2026\" startMonth=\"1\" startDay=\"6\" startHour=\"15\" startMinute=\"31\">Tue, Jan 6, 2026 at 3:31pm</time> <a href=\"https://otter.ai/u/<otid>\">Title</a> #meeting",
  "children": [
    {"name": "otter.ai/u/<otid>"},
    {"name": "<b>Overview</b>", "children": [{"name": "<overview text>"}]},
    {"name": "<b>Action Items</b>", "children": [{"name": "Action item text (@Assignee)", "layoutMode": "todo"}]},
    {"name": "<b>Outline</b>", "children": [<from speech_outline>]}
  ]
}
```

Build outline children from `speech_outline`:

- Each top-level item → `<b>Section Title</b>` with children
- Each segment → child node with text

Build action items children from `speech_action_items`:

- Each item → `{"name": "<text>", "layoutMode": "todo"}` for native checkbox
- If assignee exists, append `(@<assignee.name>)` to the name
- If completed in Otter, also add `"completed": true`

**Create node:**

```bash
./bin/run.js node create --parent-path "📆 Calendar" --json '<ENTRY_JSON>' --position bottom
```

**In `stage` mode, do not create the node.** Instead append a proposal object to the staged `proposals[]` array (see **Staging Mode**) whose single `applyOps` entry is exactly the `node create` command above with the entry JSON inlined. The in-session guard file and the create-error handling below apply only to `create` mode.

**Handle create errors — never blindly retry.** Workflowy can rate-limit (HTTP 429) and return an error _after the node was already created server-side_. A naive retry then produces a duplicate (exactly the failure mode this scanner exists to prevent). So on any create error: refresh the cache, re-check whether the meeting now exists, and only retry if it genuinely does not.

```bash
# On create error: refresh, then re-check existence
./bin/run.js cache sync-node --path "📆 Calendar"
./bin/run.js node search --query "otter.ai/u/<otid>" --limit 1 --json
```

- If the search now finds it → the create **started**, but do not treat existence as success. See the structural audit below.
- If still not found → wait a few seconds for the rate limit to clear, then retry the create once. Re-check again before any further retry.

**Existence is not completeness — audit the structure.** A 429 can land the entry and then truncate the rest of the tree mid-write. The `otter.ai/u/<otid>` child is created _before_ the `Outline` subtree, so the URL search matches a half-written entry just as readily as a complete one. Treating that match as success leaves a meeting in the calendar with an empty `Outline`, and because its otid is recorded and the cursor advances past it, nothing ever revisits it.

So after any create that errored, compare the entry against the Otter source and repair rather than re-create:

```bash
./bin/run.js node get --id <new-entry-id> --depth 3 --json --fields name,children
```

Check the action-item count, the number of `Outline` sections, and the segment count under each section against the source. If any are short, create only the missing children — never delete and re-create the entry, which would lose the otid link and risk a duplicate. Re-audit after repairing.

This is worth doing for every created entry when a run hit any 429, not just the entry that reported one: observed in the 2026-08-14 run, where `Biweekly Review` was created with 0 of 5 outline sections and its own 429 had been dismissed as "already landed."

After the node exists (created cleanly, or confirmed created after an error), record the otid in the session guard file so later pages in this same run do not re-create it:

```bash
echo "<otid>" >> .llm/gtd/journal/logs/otter-created-this-session.txt
```

## Save State

After processing each page, update state.

**In `stage` mode, skip the live state write entirely.** Make no `node update` / `node create` on the state node. Compute the same state object and emit it as the top-level `scannerState` field of the staged proposal (see **Staging Mode**); the former apply step persisted it only after the entries were created.

**Important: the state JSON must be single-line**, because Workflowy interprets newlines as separate child nodes. If building it with `jq`, use the `-c` (compact) flag:

```bash
# Build state JSON - MUST be single-line (use jq -c if building dynamically)
STATE_JSON=$(jq -cn --arg cursor "$CURSOR" --argjson start "$SESSION_START" --arg otid "$OTID" \
  '{cursor: $cursor, session_start: $start, last_synced_otid: $otid, reached_beginning: false}')
# Result: {"cursor":"123","session_start":1768518232,"last_synced_otid":"abc","reached_beginning":false}

# Get existing state node ID
STATE_NODE=$(./bin/run.js node get --path "Metadata,⚙️ Scanner State,otter-journal-scanner" --depth 1 --json --fields children 2>/dev/null \
  | jq -r '.children[0].id // empty')

if [[ -n "$STATE_NODE" ]]; then
  # Update existing state node
  ./bin/run.js node update --id "$STATE_NODE" --name "$STATE_JSON"
else
  # First run - create state node (--create-path creates parent structure)
  ./bin/run.js node create --parent-path "Metadata,⚙️ Scanner State,otter-journal-scanner" --name "$STATE_JSON" --create-path
fi
```

## Staging Mode

When invoked in `stage` mode by a staging workflow, produce a single staged proposal file instead of writing to Workflowy. Follow the on-disk schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`.

Create the directory and write `.llm/gtd/review/proposals/otter-journal.json`:

```bash
mkdir -p .llm/gtd/review/proposals
```

The file uses key `otter-journal`:

- `task`: `"otter-journal"`
- `taskNodeId`: full UUID of the prep node (passed in by the command)
- `generatedAt`: ISO-8601 timestamp with offset
- `status`: `ready` (meetings staged) | `empty` (all caught up) | `needs-interactive` (first run, no state) | `error`
- `presentation`: `"Sync Otter meetings"`
- `summary`: `{ "meetingsScanned": N, "proposalsStaged": M }`
- `proposals[]`: one object per new meeting:
    - `nodeId`: `null` — the node does not exist yet (this is a create, not an update)
    - `header`: short date label, e.g. `"Jan 6"`
    - `before`: `""` (nothing exists yet)
    - `after`: the entry `name` (the `<time>` tag + linked title + `#meeting` line)
    - `changes`: `[{ "type": "create", "icon": "🏷️", "detail": "new meeting entry" }]`
    - `applyOps`: a single-element array holding the exact `node create --parent-path "📆 Calendar" --json '<ENTRY_JSON>' --position bottom` command, with the full entry JSON (overview, action items, outline children) inlined and shell-escaped
- `scannerState`: **top-level** (not per-proposal) — the exact next state to persist on accept: `{ "cursor": "<newest cursor>", "session_start": <session_start>, "last_synced_otid": "<newest scanned otid>", "reached_beginning": <bool> }`. This is the same object `create` mode would have written in **Save State**; here it rides along for a staging workflow to persist only after the entries are created.

Make no Workflowy writes (refreshing the local SQLite dedup cache via `cache sync-node` is a read and is allowed). Do not touch the session-guard file or the live scanner-state node. After writing the file, stop and report a one-line summary.

If no new meetings are found, still write the file with `status: "empty"`, an empty `proposals[]`, and **no** `scannerState` — the cursor must not advance when nothing was staged.

## Check End Conditions

- If `end_of_list: true` → set `reached_beginning: true`, done
- If hit `last_synced_otid` → done (caught up)
- Otherwise → continue to next page with new cursor

## Return Format

```text
Otter Sync Complete:
- Created: 4 entries (Jan 5 to Jan 6, 2026)
- Cursor saved at: 1762808594
```

If all caught up:

```text
Otter Sync: All meetings already synced (newest: Jan 6, 2026)
```

## Quick Reference

**First run:**

- No state exists
- Asks user how far back to sync (do NOT scan everything unbounded)
- Creates `Metadata > ⚙️ Scanner State > otter-journal-scanner` structure
- Syncs meetings within the chosen window

**Subsequent runs:**

- Loads state, uses `last_synced_otid` as the stop boundary
- Syncs only new meetings until hitting `last_synced_otid`
- If already caught up (newest meeting matches cursor), reports "all synced"

**Interrupted sync:**

- Cursor persists in state
- Resume with same `session_start` and cursor
- Continues where it left off
