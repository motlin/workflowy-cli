---
name: otter-journal-auto
description: Auto half of daily-review Otter ingestion — scan Otter.ai for meetings newer than the cursor, calendar-dedup against 📆 Calendar, create the survivors under 📆 Calendar, advance the live scanner cursor, then stage a briefing fragment. Fully autonomous; no confirmation gate.
---

# Otter → Journal — Auto

Ingest new Otter.ai meetings into the Workflowy `📆 Calendar` without prompting. Cursor-based dedup plus a calendar-match backstop ensure only new meetings are created. The live prep task carries `Auto`, so it stages a briefing fragment instead of a confirmable proposal.

It is the head of `Serial: Calendar journal`: it creates the entries that `refine-journal-prep` and `refine-exercise-prep` then refine.

## Auto contract (read this first)

- **Fully autonomous.** Never call `AskUserQuestion` / `TaskCreate` / `TaskUpdate` / `TodoWrite`. There is no confirmation gate; deduplicated new meetings are created automatically.
- **Read, don't rebuild, metadata.** The DAG runs the import barrier and `metadata-sync` once before fan-out. Read the cache as-is.
- **Idempotent via the cursor.** Dedup is cursor-based (`last_synced_otid`) with a calendar-match backstop, so a re-run creates nothing new.

## Load scanner state

State lives under `Metadata > ⚙️ Scanner State > otter-journal-scanner` as a JSON child node:

```json
{
	"cursor": "1762808594",
	"session_start": 1736283600,
	"last_synced_otid": "abc123",
	"reached_beginning": false
}
```

- **State exists with `last_synced_otid`** → incremental scan: create only meetings newer than that otid.
- **First run (no state)** → choosing how far back to sync needs the user (an unbounded scan of hundreds of meetings is not safe to auto-run). Auto cannot prompt, so create nothing, stage a briefing with `status: "error"` and a line explaining a first-run scope choice is required, and stop — the user seeds state by running the Otter scanner manually in `create` mode. (In practice state already exists, so this is a guard, not a normal path.)

## Refresh the dedup cache

New Otter meetings are flat direct children of `📆 Calendar`. The import barrier already refreshed these, so this is normally a fast no-op:

```bash
./bin/run.js cache sync-node --path "📆 Calendar"
```

## Scan Otter and create (create mode)

Run the `otter-journal-scanner` agent in its default **`create`** mode — it scans meetings newer than `last_synced_otid`, builds the entry JSON, calendar-dedups each against `📆 Calendar` (`node search --query "otter.ai/u/<otid>"`), **creates** each surviving meeting as a direct child of `📆 Calendar`, and advances the live `otter-journal-scanner` state after each page:

```text
Task tool:
- subagent_type: "gtd:otter-journal-scanner"
  prompt: "Create mode for otter-journal-auto: scan Otter for meetings newer than last_synced_otid, calendar-dedup against 📆 Calendar, CREATE each new meeting under 📆 Calendar, and advance the live scanner state. Return the list of created meetings (date + title + otid) and the newest otid now recorded."
```

(The scanner reuses `${CLAUDE_PLUGIN_ROOT}/scripts/otter_sync.py` / `otter-api.sh` for pagination; `OTTER_USERNAME` / `OTTER_PASSWORD` must be set. If the scan fails — auth, network, API — create nothing, stage a briefing with `status: "error"` carrying the error, and stop; the review surfaces it and the cursor is untouched, so the meetings resurface next run.)

## Stage the briefing

Create the directory, then write `.llm/gtd/review/briefings/otter-journal.json` per the briefing schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`:

```bash
mkdir -p .llm/gtd/review/briefings
```

```json
{
	"task": "otter-journal",
	"status": "ready",
	"lines": ["📅 Added 1 Otter meeting: Platform Upgrades and Metrics (Jun 30)"],
	"autoApplied": ["Created 'Platform Upgrades and Metrics' under 📆 Calendar; cursor → 5m88r5g…"]
}
```

- `status`: `ready` (one or more created) | `empty` (caught up — nothing newer survived dedup) | `error` (scan failed or first-run scope needed).
- `lines`: folded verbatim into the daily-review summary — one line per created meeting, or `"📅 No new Otter meetings"` when empty.
- `autoApplied`: what the auto run did (entries created, new cursor otid), for transparency.

## Summary

The daily review folds the staged `lines` into the final summary. Return verified success or empty with a one-line status. Return failure on scan or state errors. The DAG executor advances the keyed prep date only after success or empty.

## Idempotency

A re-run creates nothing: the scanner's cursor-based dedup finds nothing newer than the just-persisted `last_synced_otid`, and the calendar-match backstop catches anything the cursor missed. The briefing then reads `status: "empty"`.
