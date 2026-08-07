---
name: journal
description: GTD journal ingestion — scan sources for past events that already happened and log them under the right dates in the Workflowy system calendar. Use when the user wants to journal or backfill what they did, record past activity, or sync completed events to their calendar. For future to-dos use /gtd:capture instead.
---

# GTD Journal Ingestion

Scan external sources for past events and create journal entries under the appropriate calendar dates in the Workflowy system calendar. Future-facing tasks belong in `/gtd:capture`.

Two agent types (see Journal Scanner Agents below for the full list):

- **Sync agents** (URL-based sources): dedup via SQLite, create entries directly.
- **Scan agents** (non-URL sources): write to `.llm/gtd/journal/scans/<source>.json` for central dedup.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the phases or per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Workflow

### Setup

```bash
mkdir -p .llm/gtd/journal/scans
mkdir -p .llm/gtd/journal/analysis
```

### Run Sync Agents (URL-based - parallel)

Launch sync agents in parallel. These handle dedup and creation directly:

```text
Task tool calls (parallel):
- subagent_type: "gtd:otter-journal-scanner"
  prompt: "Sync Otter meetings to Workflowy calendar"

- subagent_type: "gtd:github-journal-scanner"
  prompt: "Sync GitHub activity (merged PRs, closed issues) to Workflowy calendar"

- subagent_type: "gtd:gmail-journal-scanner"
  prompt: "Sync Gmail events (purchases, travel) to Workflowy calendar"
```

### Run Scan Agents (non-URL - parallel)

Launch scan agents in parallel. These write to JSON for central dedup:

```text
Task tool calls (parallel):
- subagent_type: "gtd:calendar-journal-scanner"
  prompt: "Scan calendar for past events that actually occurred"

- subagent_type: "gtd:imessage-journal-scanner"
  prompt: "Scan iMessages for mentions of completed activities and meetups"

- subagent_type: "gtd:reminders-journal-scanner"
  prompt: "Scan Reminders for recently completed items"

- subagent_type: "gtd:things3-journal-scanner"
  prompt: "Scan Things 3 for recently completed tasks"

- subagent_type: "gtd:tvtime-journal-scanner"
  prompt: "Scan TV Time for recently watched episodes"

- subagent_type: "gtd:photos-journal-scanner"
  prompt: "Scan Photos for recent activities and events"

- subagent_type: "gtd:chrome-journal-scanner"
  prompt: "Scan Chrome history for high-engagement pages visited"
```

Wait for all to complete. Collect results from `.llm/gtd/journal/scans/*.json`.

**Collect All Scanned Events:**

```bash
# Merge all scan results into a single array
jq -s '[.[].items // [] | .[] ]' .llm/gtd/journal/scans/*.json 2>/dev/null || echo '[]'
```

If no events found across all scanners, report "No events to journal" and exit.

### Deduplicate & Analyze (User Interaction)

Dedup events against existing calendar entries, then group surviving events by date and show a brief list grouped by date with source attribution.

Confirm via AskUserQuestion with options `Yes, create journal entries` and `Cancel`.

**Write Confirmed List:** Write `{ events: [<event objects per Event Format>] }` to `.llm/gtd/journal/confirmed.json`.

### Execute Journal Entries

Only proceed after user confirmation from the Deduplicate & Analyze section.

**All node creation goes through journal-executor.** The orchestrator never creates nodes directly.

Launch the journal-executor agent:

```text
Task tool:
- subagent_type: "gtd:journal-executor"
  prompt: "Execute confirmed journal entries from .llm/gtd/journal/confirmed.json"
```

### Summary & Log

After `journal-executor` completes, print entries-created grouped by date and by source, then log to Session Memory:

> Run `./bin/run.js node create --help` to verify available flags before constructing commands.

```bash
TODAY=$(date +%Y-%m-%d)

# Log under today's date node, creating it if missing (--create-path is idempotent)
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory,$TODAY" \
  --name "Journal ingestion: X events logged from Y sources" --create-path --position bottom
```

## Journal Scanner Agents

### Sync Agents (URL-based, create entries directly)

| Scanner                  | Source            | URL Pattern           | Typical Events                        |
| ------------------------ | ----------------- | --------------------- | ------------------------------------- |
| `otter-journal-scanner`  | Otter.ai (Chrome) | `otter.ai/u/*`        | Meeting transcripts with AI summaries |
| `github-journal-scanner` | GitHub API        | `github.com/*/pull/*` | Merged PRs, closed issues             |
| `gmail-journal-scanner`  | Gmail MCP         | `mail.google.com/*`   | Confirmations, receipts, travel       |

### Scan Agents (non-URL, write to JSON)

| Scanner                     | Source          | Typical Events                          |
| --------------------------- | --------------- | --------------------------------------- |
| `calendar-journal-scanner`  | Apple Calendar  | Completed past events                   |
| `imessage-journal-scanner`  | iMessage        | Activity mentions, meetup confirmations |
| `reminders-journal-scanner` | Apple Reminders | Completed reminders                     |
| `things3-journal-scanner`   | Things 3        | Completed tasks                         |
| `tvtime-journal-scanner`    | TV Time         | Recently watched episodes               |
| `photos-journal-scanner`    | Apple Photos    | Activities, places visited, experiences |
| `chrome-journal-scanner`    | Chrome History  | High-engagement pages (could be sync)   |

## Event Format

Each scanner returns events in this format:

```json
{
  "id": "<source>-<hash>",
  "title": "Human-readable event description",
  "eventDate": "YYYY-MM-DD",
  "eventTime": "HH:MM",
  "source": "<scanner-name>",
  "category": "<event-category>",
  "confidence": "high",
  "metadata": {
    "...source-specific fields..."
  }
}
```

**Categories:**

- `development` - Code, PRs, deployments
- `meeting` - Calendar events, calls
- `communication` - Emails, messages
- `purchase` - Orders, receipts
- `activity` - Social events, activities
- `entertainment` - TV shows, movies watched
- `article` - Blog posts, articles read
- `video` - YouTube, tutorials watched
- `task` - Completed tasks, reminders
- `dining` - Restaurant visits, meals out
- `travel` - Places visited, trips

## Error Handling

- **iMCP halt:** If any scanner returns `status: "imcp-unavailable"` (or `fatal: true`), **STOP the entire journal run immediately**. Display that scanner's `message` to the user and do not proceed to ingestion. iMCP-backed scanners (calendar, reminders, imessage) must not be silently skipped — the user has to get iMCP running, then re-run `/gtd:journal`. See `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md`.
- If a non-iMCP scanner fails, continue with remaining scanners
- Report failed scanners in the summary
- If all scanners fail, exit with error
- If no events found, exit gracefully
- If journal-executor fails partially, report which entries succeeded

## Related Commands

- `/gtd:capture` - Capture future tasks to inbox
- `/gtd:inbox` - Process captured items through refinement

## Related Skills

- **system-calendar** - Finding and creating calendar date nodes
- **calendar-dates** - Workflowy native date format
