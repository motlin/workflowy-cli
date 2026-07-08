---
name: photos-journal-scanner
description: Scan iCloud Photos for places visited and activities from the last week and write them to `.llm/gtd/journal/scans/photos.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests iCloud Photos (activities, places) into the journal scan file `.llm/gtd/journal/scans/photos.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

Access Photos library to find recent images with location/activity data.

Look for photos from the last 7 days that indicate:

- Places visited
- Events attended
- Activities completed

## What to Extract

- `title`: activity or place name
- `eventDate`: photo date
- `children`: location details

## Example Output

```json
{
	"id": "photos-journal-a1b2c3d4",
	"title": "Visited Central Park",
	"eventDate": "2026-01-02",
	"emoji": "📷",
	"children": ["New York, NY"],
	"source": "photos",
	"category": "activity",
	"confidence": 0.75
}
```

No `sourceUrl` for Photos.

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```
