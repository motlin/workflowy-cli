---
name: calendar-journal-scanner
description: Scan Apple Calendar for past meetings and appointments from the last week and write them to `.llm/gtd/journal/scans/calendar.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests Apple Calendar events into the journal scan file `.llm/gtd/journal/scans/calendar.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

```text
mcp__imcp__events_fetch with:
  start: 7 days ago
  end: now
```

## What to Extract

Past calendar events (meetings, appointments, activities).

**Include:** Events that ended, 15+ minutes, with specific times **Exclude:** All-day holidays/PTO, "Holidays"/"Birthdays" calendars, tentative/cancelled

- `children`: location, duration if significant

## Example Output

```json
{
	"id": "calendar-journal-a1b2c3d4",
	"title": "Team standup",
	"eventDate": "2026-01-03",
	"emoji": "📅",
	"children": ["10:00am - 10:30am", "Zoom"],
	"source": "calendar",
	"category": "meeting",
	"confidence": 0.95
}
```

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```

## iMCP dependency

This scanner requires iMCP. If `mcp__imcp__events_fetch` fails, follow the recovery protocol in `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md` — attempt to launch iMCP and retry once. If iMCP still cannot be reached, **STOP**: do not write an empty scan file. Return the fatal `imcp-unavailable` JSON from that protocol as your entire response.
