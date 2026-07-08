---
name: tvtime-journal-scanner
description: Scan TV Time for episodes watched in the last week and write them to `.llm/gtd/journal/scans/tvtime.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests TV Time (watched episodes) into the journal scan file `.llm/gtd/journal/scans/tvtime.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

Use Chrome DevTools MCP to access TV Time.

```text
mcp__chrome-devtools__navigate_page with url: "https://www.tvtime.com/en/user/[username]/profile"
mcp__chrome-devtools__take_snapshot
```

Look for episodes marked as watched in the last 7 days.

## What to Extract

- `title`: "Watched: [Show] S01E01 #watched" (zero-padded `SxxEyy`; always end with `#watched`)
- `eventDate`: watch date
- `children`: episode title

## Example Output

```json
{
	"id": "tvtime-journal-a1b2c3d4",
	"title": "Watched: The Bear S03E01 #watched",
	"eventDate": "2026-01-02",
	"emoji": "📺",
	"children": ["Tomorrow"],
	"source": "tvtime",
	"category": "entertainment",
	"confidence": 0.9
}
```

No `sourceUrl` for TV Time.

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```
