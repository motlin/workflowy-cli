---
name: reminders-journal-scanner
description: Scan Apple Reminders for items completed in the last week and write them to `.llm/gtd/journal/scans/reminders.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests Apple Reminders (completed items) into the journal scan file `.llm/gtd/journal/scans/reminders.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

```text
mcp__imcp__reminders_fetch with:
  completed: true
  start: 7 days ago
  end: now
```

## What to Extract

Completed reminders with their completion dates.

## Example Output

```json
{
	"id": "reminders-journal-a1b2c3d4",
	"title": "Bought shinguards",
	"eventDate": "2026-01-02",
	"emoji": "✅",
	"source": "reminders",
	"category": "task",
	"confidence": "high"
}
```

No `sourceUrl` for Reminders.

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```

## iMCP dependency

This scanner requires iMCP. If `mcp__imcp__reminders_fetch` fails, follow the recovery protocol in `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md` — attempt to launch iMCP and retry once. If iMCP still cannot be reached, **STOP**: do not write an empty scan file. Return the fatal `imcp-unavailable` JSON from that protocol as your entire response.
