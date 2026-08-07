---
name: capture
description: GTD bulk capture — scan external sources (Otter transcripts, plus other scanners when enabled) for actionable items and capture them to the inbox after confirmation; pass text to capture a single item directly. Use when the user wants to sweep their sources for new to-dos, run a capture pass, or quickly drop a thought into the GTD inbox.
arguments:
    - name: item
      description: Optional item text to capture directly (skips scanning)
      required: false
---

# GTD Bulk Capture

This command has two modes:

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the phases or per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Mode 1: Quick Capture (with arguments)

When text is provided as an argument, capture it directly to inbox without scanning:

> Run `./bin/run.js node create --help` to verify available flags before constructing commands.

```bash
# Get today's date for the Added timestamp
TODAY=$(date +"%a, %b %-d, %Y")
YEAR=$(date +"%Y")
MONTH=$(date +"%-m")
DAY=$(date +"%-d")

./bin/run.js node create \
  --parent-id inbox \
  --json '{
    "name": "<item text>",
    "children": [
      {"name": "📜 Provenance: user://input"},
      {"name": "➕ Added: <time startYear=\"'$YEAR'\" startMonth=\"'$MONTH'\" startDay=\"'$DAY'\">'$TODAY'</time>"}
    ]
  }'
```

After creating the node, optionally launch background refinement:

```text
Task tool (background):
- subagent_type: "gtd:item-refiner"
  prompt: "Refine inbox item: <item text>"
  run_in_background: true
```

Report success and exit - do NOT run the full scanner workflow.

## Mode 2: Bulk Scan (no arguments)

Scan multiple external sources and process them into the GTD inbox via a five-phase fan-out: Load → Scan → Deep-dive + Analyze → Synthesize → Execute.

## Workflow

### Load Data (Phase 1 - Parallel)

Launch all three loader agents in parallel using the Task tool:

```text
Task tool calls (parallel):
- subagent_type: "gtd:metadata-sync"
  prompt: "Sync GTD metadata to .llm/gtd/metadata/"

- subagent_type: "gtd:declined-loader"
  prompt: "Load recently declined items to .llm/gtd/capture/declined.json"

- subagent_type: "gtd:existing-tasks-loader"
  prompt: "Load existing tasks for duplicate detection to .llm/gtd/capture/existing-tasks.json"
```

Wait for all to complete.

### Scan All Sources (Phase 2 - Parallel)

Launch scanner agents in parallel using the Task tool. Currently only `otter-scanner` is active — see the Scanner Agents table below for the full disabled list.

```text
Task tool calls (parallel):
- subagent_type: "gtd:otter-scanner"
  prompt: "Scan Otter.ai for meeting transcripts needing action items"
```

Wait for all to complete. Collect results from `.llm/gtd/capture/scans/*.json`.

**Collect All Scanned Items:**

```bash
# Merge all scan results into a single array
jq -s '[.[].items // [] | .[] ]' .llm/gtd/capture/scans/*.json 2>/dev/null || echo '[]'
```

If no items found across all scanners, report "No new items to capture" and exit.

### Project Deep Dive (Parallel per Project)

Extract unique project IDs from scanned items that have project associations:

```bash
# Get unique project IDs from item metadata
jq -r '[.[].items // [] | .[] | .metadata.projectId // empty] | unique | .[]' .llm/gtd/capture/scans/*.json 2>/dev/null
```

Launch one `project-deep-diver` per unique project:

```text
For each projectId, launch Task tool:
- subagent_type: "gtd:project-deep-diver"
  prompt: "Deep dive into project with ID <projectId>"
```

Wait for all to complete. Results will be in `.llm/gtd/capture/projects/<projectId>.json`.

### Analyze Items (Parallel per Item)

Launch one `item-analyzer` per scanned item:

```text
For each item, launch Task tool:
- subagent_type: "gtd:item-analyzer"
  prompt: |
    Analyze this scanned item for capture:
    ID: <itemId>
    Title: <title>
    Source: <source>
    Confidence: <confidence>
    Metadata: <metadata JSON>
```

Wait for all to complete. Collect results from `.llm/gtd/capture/analysis/*.json`.

### Synthesis Phase (User Interaction)

After all `item-analyzer` agents complete, group results by recommendation:

**Read all analysis results:**

```bash
jq -s '.' .llm/gtd/capture/analysis/*.json 2>/dev/null || echo '[]'
```

**Group by recommendation:**

| Recommendation | Action                                                  |
| -------------- | ------------------------------------------------------- |
| `capture`      | Auto-accept, add to confirmed list                      |
| `skip`         | Exclude silently (duplicate, already done, or declined) |
| `ask`          | Present to user for decision                            |

**For `ask` items, use AskUserQuestion:**

Present each low-confidence item with context:

```text
Question: "Item: '<title>' from <source>. Confidence: <confidence>. Reason: <reasoning>. What would you like to do?"

Options:
- "Capture to inbox (Recommended)"
- "Skip - not actionable"
- "Skip - already done elsewhere"
- "Skip - defer for later"
```

**Summary and Final Confirmation:**

After resolving all `ask` items, show a short summary (capture counts by source, skip counts by reason) and confirm via AskUserQuestion with options `Yes, proceed with capture` and `Cancel`.

**Write Confirmed List:**

Write `{ items: [{id, title, source, metadata}], declined: [{id, title, reason}] }` to `.llm/gtd/capture/confirmed.json`.

### Execute Captures (Phase 5)

Only proceed after user confirmation from the Synthesis Phase.

Use the capture-executor agent for this step:

```text
Task tool:
- subagent_type: "gtd:capture-executor"
  prompt: "Execute confirmed captures from .llm/gtd/capture/confirmed.json"
```

The capture-executor will:

- Create inbox nodes with provenance children
- Launch background `item-refiner` agents for each captured item
- Record declined items to Session Memory
- Clean up the confirmed.json file
- Return summary of captures executed

### Summary & Log

After `capture-executor` completes, print captured-count, declined-count, and `Run /gtd:inbox to process captured items.` Log to Session Memory:

```bash
TODAY=$(date +%Y-%m-%d)

# Log under today's date node, creating it if missing (--create-path is idempotent)
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory,$TODAY" \
  --name "Bulk capture: X items captured from Y sources" --create-path --position bottom
```

## Scanner Agents

The following scanner agents are available:

| Scanner                     | Source                | Status     | Typical Items                       |
| --------------------------- | --------------------- | ---------- | ----------------------------------- |
| `otter-scanner`             | Otter.ai              | **Active** | Transcripts needing review          |
| `chrome-scanner`            | Chrome tabs & history | Disabled   | Open tabs, high-engagement pages    |
| `git-scanner`               | Local Git repos       | Disabled   | Uncommitted changes, stale branches |
| `github-scanner`            | GitHub API            | Disabled   | PRs authored, review requests       |
| `gmail-scanner`             | Gmail                 | Disabled   | Starred, action-required, drafts    |
| `imessage-scanner`          | iMessage              | Disabled   | Conversations with pending actions  |
| `things3-scanner`           | Things 3 app          | Disabled   | Inbox items, today tasks            |
| `reminders-scanner`         | Apple Reminders       | Disabled   | Incomplete reminders                |
| `calendar-scanner`          | Apple Calendar        | Disabled   | Past events, upcoming prep          |
| `tvtime-scanner`            | TV Time app           | Disabled   | Shows with new episodes             |
| `photos-scanner`            | Apple Photos          | Disabled   | Actionable screenshots              |
| `workflowy-overdue-scanner` | Workflowy calendar    | Disabled   | Overdue items                       |

## Error Handling

- **iMCP halt:** If any scanner returns `status: "imcp-unavailable"` (or `fatal: true`), **STOP the entire capture run immediately**. Display that scanner's `message` to the user and do not proceed to Phase 3 or beyond. iMCP-backed scanners (calendar, reminders, imessage, photos) must not be silently skipped — the user has to get iMCP running, then re-run `/gtd:capture`. See `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md`.
- If a non-iMCP scanner fails, continue with remaining scanners
- Report failed scanners in the summary
- If all scanners fail, exit with error
- If no items found, exit gracefully
- If capture-executor fails partially, report which items succeeded

## Related Commands

- `/gtd:inbox` - Process captured items through refinement
- `/gtd:legacy:capture` - Quick single-item capture (does not use scanners)
