---
description: Remove duplicate Otter.ai meeting entries from the Workflowy calendar by matching otter.ai/u/<ID> links. Use when the calendar shows the same Otter meeting more than once, or after an Otter journal sync that may have re-added entries — runs scripts/deduplicate-otter-meetings.sh, which keeps the first occurrence of each Otter ID and supports --dry-run and --parent-path.
---

# Otter Deduplication

Removes duplicate meetings from the Workflowy calendar that were synced from Otter.ai multiple times. Each meeting has a unique Otter ID (`otter.ai/u/<ID>`); exact duplicates are detected and cleaned up automatically.

## Usage

```bash
./${CLAUDE_PLUGIN_ROOT}/scripts/deduplicate-otter-meetings.sh [--parent-path <path>] [--dry-run]
```

| Parameter       | Default       | Description                          |
| --------------- | ------------- | ------------------------------------ |
| `--parent-path` | `📆 Calendar` | Path to the node containing meetings |
| `--dry-run`     | off           | Show what would be deleted           |

## How It Works

Each meeting entry includes the Otter link in the name (Otter ID = the path segment after `otter.ai/u/`):

```html
<a href="https://otter.ai/u/xYzAbCdEfGhIjKlMnOpQrStUvWx">1:1 with @AliceBrown</a> #meeting
<time>Fri, Jan 15, 2026 at 3:30pm</time>
```

For each Otter ID with >1 occurrence, keep the first child (chronological/position order) and delete the rest. Entries without a valid Otter ID are skipped with a warning.

## Re-run safety (why this is a fallback, not the primary defense)

This cleanup exists to repair duplicates, not to license them. The ingest path (`otter-journal-scanner`, via `/gtd:otter-journal-auto`) is already idempotent, so an accidental re-run is a no-op. It layers three guards:

- **Cursor** — `Metadata > ⚙️ Scanner State > otter-journal-scanner` stores `last_synced_otid`; the scan stops there, so meetings older than the last sync are never re-scanned. The cursor advances only after meetings are processed, so an aborted auto run never skips meetings.
- **URL dedup** — every surviving `otid` is checked against `📆 Calendar` (`node search --query "otter.ai/u/<otid>"`, over a freshly non-recursively-synced cache); an existing entry is skipped.
- **In-session guard** — `.llm/gtd/journal/logs/otter-created-this-session.txt` catches same-run creates the cache cannot yet see.

Any ingest that skips these guards — e.g. state kept only in a `/tmp` file with no Workflowy-side check — will duplicate the whole calendar on a re-run once that tmp state is gone. Route bulk imports through the scanner agent, not a standalone script.

## Related Skills

- **otter-journal-scanner** - Otter.ai meeting ingestion logic
- **calendar-dates** - Workflowy calendar date format
