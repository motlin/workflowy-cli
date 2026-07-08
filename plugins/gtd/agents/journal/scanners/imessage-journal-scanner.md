---
name: imessage-journal-scanner
description: Scan iMessages for mentions of completed activities from the last week and write them to `.llm/gtd/journal/scans/imessage.json`. Invoked by the gtd:journal orchestrator to log past events to the Workflowy calendar.
model: sonnet
color: cyan
---

This journal agent ingests iMessage activity (mentioned activities, meetups) into the journal scan file `.llm/gtd/journal/scans/imessage.json`.

See skill `gtd/journal-scanner-output` for output format.

## What to Search

```text
mcp__imcp__messages_fetch with:
  limit: 200
```

Filter to last 7 days.

## Attribution

Messages are FROM others. Attribute to sender:

- ❌ "Went for a walk"
- ✅ "@Alice went for a walk"

Match contacts to @tags using `.llm/gtd/metadata/people.json`. It is large (40k+ lines) — do **not** read it whole. Extract a compact tag/phone lookup with `jq`:

```bash
jq -c '[.. | objects
  | select(.name? and (.name|type=="string") and (.name|startswith("@")))
  | {tag: .name, shortId,
     phones: [(.children // [])[] | select(.name? and (.name|type=="string") and (.name|test("Phone"))) | .name]}]' \
  .llm/gtd/metadata/people.json
```

## Timezone

Message timestamps are UTC. Convert to local time:

```bash
date +%z  # Get offset like "-0500"
```

A message at `2026-01-03T01:17Z` is `2026-01-02T20:17` in EST (different date!).

## What to Extract

Look for past-tense patterns:

- "went to", "had", "was fun", "just finished"
- "arrived", "landed", "checked in"
- "bought", "picked up"

## Example Output

```json
{
	"id": "imessage-journal-a1b2c3d4",
	"title": "@Alice went for a walk",
	"eventDate": "2026-01-02",
	"emoji": "💬",
	"source": "imessage",
	"category": "activity",
	"confidence": 0.75
}
```

No `sourceUrl` for iMessage.

## Setup

```bash
mkdir -p .llm/gtd/journal/scans
```

## iMCP dependency

This scanner requires iMCP. If `mcp__imcp__messages_fetch` fails, follow the recovery protocol in `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md` — attempt to launch iMCP and retry once. If iMCP still cannot be reached, **STOP**: do not write an empty scan file. Return the fatal `imcp-unavailable` JSON from that protocol as your entire response.
