---
name: calendar-dates
description: Create and find date nodes in the Calendar using Workflowy's native date format. Use when moving items to calendar dates.
---

# Calendar Date Nodes

This skill documents how to work with date nodes in the Workflowy Calendar, including:

- Using Workflowy's bracket date format
- Finding existing dates before creating duplicates
- Creating new date nodes when needed

## Workflowy Bracket Date Format

The Workflowy **web UI** converts bracket-formatted dates into native clickable, filterable date elements. The **CLI/API does not** — a bracket date written via the CLI is stored as literal text until the user runs the web UI "Update" migration. For date nodes that must render immediately (calendar day nodes, due dates, review date advancement), write an explicit `<time>` element instead and compute its weekday with the `date` command — see [Creating Date Nodes](#creating-date-nodes) and the `workflowy-html` / `review-date-updates` skills.

**Date Format:**

```text
[YYYY-MM-DD]
```

**DateTime Format:**

```text
[YYYY-MM-DD HH:MM]
```

**Examples:**

```text
[2025-12-23]
[2025-01-05]
[2025-12-15 14:30]
```

**Important:** Use ISO 8601 format with zero-padded months/days: `[2025-01-05]` not `[2025-1-5]`.

### Using the Helper Functions

The codebase includes helper functions in `packages/shared/src/workflowy/constants.ts`:

```typescript
import {formatWorkflowyDate, formatWorkflowyDateTime} from '../workflowy/constants';

// From a date string
formatWorkflowyDate('2025-12-23');
// Returns: [2025-12-23]

// From a Date object
formatWorkflowyDate(new Date());
// Returns: [2025-01-10] (today's date)

// DateTime with time
formatWorkflowyDateTime(new Date());
// Returns: [2025-01-10 14:30] (current datetime)
```

## Calendar Structure

Workflowy has a built-in `📅 Calendar` node at root level. Dates are stored directly under it:

```text
📅 Calendar
├── Mon, Dec 23, 2025
├── Tue, Dec 24, 2025
└── ...
```

Date nodes are created with bracket syntax and Workflowy renders them as native date elements.

## Finding Existing Date Nodes

**CRITICAL: Always search for existing dates before creating new ones.**

### Get Calendar Node IDs from Metadata

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

```bash
./bin/run.js node get --path "Metadata,📅 Calendar" --depth 2
```

This returns metadata about configured Calendar nodes.

### Search for the Date

Use the search command with the date in display format:

```bash
# Search for a specific date across the entire tree
./bin/run.js node search --query "Dec 23, 2025" --limit 10
```

Or search within a specific calendar subtree:

```bash
# Get the calendar ID first, then search its descendants
./bin/run.js node get --id <CALENDAR_NODE_ID> --depth 10 | grep "Dec 23, 2025"
```

### Verify Match is a Date Node

A date node contains a native Workflowy date (originally created with bracket syntax). The search result should show:

```text
Mon, Dec 23, 2025
```

The date is rendered as a clickable element. If the match is just plain text mentioning the date, it's NOT a date node.

## Creating Date Nodes

Only create a date node if the Search for the Date section finds no existing match.

**Bracket text vs. immediate date element:** A bracket date (`[YYYY-MM-DD]`) written via the CLI stays literal text until the web UI "Update" migration runs — it does **not** become a clickable date element on write. Use bracket text only for the deferred journal-ingestion flow below (where you later run "Update"). For a date node that must render and be parseable immediately, write an explicit `<time>` element and **compute its weekday with `date` — never type the weekday by hand:**

```bash
ISO=2025-12-23
TIME_EL=$(printf '<time startYear="%s" startMonth="%s" startDay="%s">%s</time>' \
  "$(date -j -f %Y-%m-%d "$ISO" +%Y)" "$(date -j -f %Y-%m-%d "$ISO" +%-m)" \
  "$(date -j -f %Y-%m-%d "$ISO" +%-d)" "$(date -j -f %Y-%m-%d "$ISO" '+%a, %b %-d, %Y')")
./bin/run.js node create --parent-id <CALENDAR_NODE_ID> --name "$TIME_EL"
```

### Determine Target Parent

- For **current/upcoming dates**: Create under the Calendar's Current section or directly under Calendar
- For **past dates**: Create under Archive (following the existing year structure)

### Create the Node

```bash
# Use bracket syntax - Workflowy converts it to native date
./bin/run.js node create --parent-id <CALENDAR_OR_CURRENT_NODE_ID> \
  --name '[2025-12-23]' \

```

## Complete Workflow Example

When moving an item to a calendar date:

```bash
# 1. Determine the target date (e.g., from item's creation date)
TARGET_DATE="2025-12-23"  # YYYY-MM-DD format

# 2. Search for existing date node
./bin/run.js node search --query "Dec 23, 2025" --limit 5

# 3a. If found, get the node ID from search results
DATE_NODE_ID="<found-node-id>"

# 3b. If NOT found, create it using bracket syntax
./bin/run.js node create --parent-id <CALENDAR_NODE_ID> \
  --name '[2025-12-23]' \

# Capture the returned ID

# 4. Move the item to the date node
./bin/run.js node move --node-id <ITEM_ID> --parent-id <DATE_NODE_ID>
```

## Date Format Reference

The bracket syntax requires ISO 8601 format with zero-padded values:

| Format    | Example              | Result                       |
| --------- | -------------------- | ---------------------------- |
| Date only | `[2025-12-23]`       | Mon, Dec 23, 2025            |
| With time | `[2025-12-23 14:30]` | Mon, Dec 23, 2025 at 2:30 PM |

Workflowy handles all display formatting automatically.

## Journal Entry Workflow (Recommended for Agents)

For automated journal ingestion, create entries with **inline datetime** directly under the Calendar.

### Why Inline Datetime?

- Simplest: No need for staging folders or date parent nodes
- Workflowy migration works: "Update" reorganizes entries with inline dates
- Clean: Staging folders get left behind after migration; inline dates don't

### Structure

```text
📆 Calendar
├── Tue, Jan 6, 2026 at 11:03am Project Kickoff #meeting
│   └── Overview...
│   └── Action Items...
├── Tue, Jan 6, 2026 at 2:30pm Team Standup #meeting
│   └── ...
├── 2026
│   └── 01
│       └── ...
```

Each entry has the datetime inline with its title. Include time (hour/minute) for proper sorting.

### DateTime with Time of Day

Use bracket syntax with time:

```text
[2026-01-06 11:03]
```

### Creating Entries

```bash
./bin/run.js node create --parent-path "📆 Calendar" \
  --name '[2026-01-06 11:03] Project Kickoff #meeting' \
  --position bottom \

```

Or with children:

```bash
./bin/run.js node create --parent-path "📆 Calendar" --json '{
  "name": "[2026-01-06 11:03] Title #tag",
  "children": [{"name": "Child 1"}, {"name": "Child 2"}]
}'
```

### Migrating to Standard Calendar Structure

Once you're happy with all new entries, migrate them in one batch:

- Open the Calendar (click the calendar icon or press Ctrl+T / Alt+T)
- Click "Settings" in the Calendar picker
- Click "Update"

Workflowy will reorganize **all** entries with dates into the proper Year > Month structure.

## Common Mistakes to Avoid

- **Creating duplicate dates**: Always search first
- **Using plain text dates**: Use bracket syntax `[YYYY-MM-DD]` for Workflowy date features
- **Not zero-padding**: Use `[2025-01-05]` not `[2025-1-5]` in bracket format
- **Only checking Current**: Dates may exist in Archive sections
- **Bypassing CLI**: Never use sqlite3 directly for writes; use the CLI
