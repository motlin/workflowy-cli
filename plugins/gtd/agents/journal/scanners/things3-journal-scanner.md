---
name: things3-journal-scanner
description: Scan Things 3 for tasks completed in the last week and write them to `.llm/gtd/journal/scans/things3.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests Things 3 (completed tasks) into the journal scan file `.llm/gtd/journal/scans/things3.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

```bash
DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/Things Database.thingsdatabase/main.sqlite"
CUTOFF=$(( $(date +%s) - 978307200 - 7*24*60*60 ))
sqlite3 "$DB" "SELECT uuid, title, stopDate FROM TMTask WHERE status = 3 AND trashed = 0 AND stopDate > $CUTOFF"
```

CoreData timestamp: `unix = coredata + 978307200`

## What to Extract

Completed tasks. Convert to past tense:

- "Finish X" → "Completed X"
- "Review X" → "Reviewed X"

## Example Output

```json
{
	"id": "things3-journal-a1b2c3d4",
	"title": "Completed project proposal",
	"eventDate": "2026-01-02",
	"emoji": "☑️",
	"source": "things3",
	"category": "task",
	"confidence": "high"
}
```

No `sourceUrl` for Things 3.

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```
