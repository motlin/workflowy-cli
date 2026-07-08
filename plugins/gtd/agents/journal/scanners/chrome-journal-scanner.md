---
name: chrome-journal-scanner
description: Scan Chrome history for high-engagement pages (articles, docs, videos) from the last week and write them to `.llm/gtd/journal/scans/chrome.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests Chrome history (high-engagement pages) into the journal scan file `.llm/gtd/journal/scans/chrome.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

Copy and query Chrome history (locked while running):

```bash
mkdir -p .llm/gtd/journal/cache
cp "$HOME/Library/Application Support/Google/Chrome/Default/History" .llm/gtd/journal/cache/chrome-history-$$.db
sqlite3 .llm/gtd/journal/cache/chrome-history-$$.db "
SELECT u.title, u.url, SUM(ca.total_foreground_duration)/1000000/60 as fg_min
FROM context_annotations ca
JOIN visits v ON ca.visit_id = v.id
JOIN urls u ON v.url = u.id
WHERE v.visit_time > (strftime('%s', 'now', '-7 days') + 11644473600) * 1000000
GROUP BY u.url HAVING fg_min >= 5
ORDER BY fg_min DESC LIMIT 30"
rm .llm/gtd/journal/cache/chrome-history-$$.db
```

## What to Extract

**Include:** Articles, docs, videos with 5+ min foreground time **Exclude:** chrome://, mail.google.com, calendar.google.com, social feeds

Title format: "Read: [title]", "Watched: [title]", "Studied: [title]"

## Example Output

```json
{
	"id": "chrome-journal-a1b2c3d4",
	"title": "Read: Building AI Agents",
	"eventDate": "2026-01-03",
	"emoji": "🌐",
	"sourceUrl": "https://example.com/building-ai-agents",
	"source": "chrome",
	"category": "article",
	"confidence": 0.7
}
```

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```
