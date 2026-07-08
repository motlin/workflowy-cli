---
description: Navigate the Workflowy system Calendar to find today's node. Use when you need to find or create items under today's date.
---

# System Calendar Node

Workflowy automatically creates a special `📆 Calendar` node for every user. This node has a fixed name and serves as the root of the calendar hierarchy.

## System Calendar Properties

| Property      | Value                             |
| ------------- | --------------------------------- |
| Name          | `📆 Calendar` (exact, with emoji) |
| Created by    | Workflowy (not user-created)      |
| Always exists | Yes                               |

## Calendar Hierarchy Structure

The calendar uses a year → month → day hierarchy:

```text
📆 Calendar
├── 2026
│   ├── 01
│   │   ├── <time>Fri, Jan 2, 2026</time>
│   │   │   └── [items for this day]
│   │   └── <time>Sat, Jan 3, 2026</time>
│   │       └── [items for this day]
│   └── 02
│       └── ...
└── 2025
    └── ...
```

Key observations:

- Years are ordered with most recent first
- Months are two-digit strings (`01`, `02`, ... `12`)
- Days use the `<time>` element format (see calendar-dates skill)
- Items are children of the day node

## Finding Today's Node

To find today's date node, traverse from the Calendar root:

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

```bash
# Get today's date components
YEAR=$(date +%Y)      # e.g., 2026
MONTH=$(date +%m)     # e.g., 01 (zero-padded)
DAY=$(date +%-d)      # e.g., 3 (not zero-padded for matching)

# Fetch calendar with depth 4 to reach day nodes
./bin/run.js node get --path "📆 Calendar" --depth 4 --json --fields id,name,children
```

Then navigate: `Calendar → {YEAR} → {MONTH} → day node matching today`

The day node name contains the date in display format: `<time ...>Sat, Jan 3, 2026</time>`

## How "Today" Button Works

When a user clicks the "Today" button in Workflowy:

1. Workflowy creates any missing hierarchy nodes (year, month, day)
2. Creates an **empty child node** under the day
3. Navigates the user to that empty child node

This means the URL after clicking "Today" points to the empty child, not the day node itself.

Example:

```text
<time>Sat, Jan 3, 2026</time>  ← day node
└── ""                          ← empty child (URL points here)
```

## Finding Today's Empty Child

To replicate the "Today" button behavior:

```bash
# Fetch with depth 5 to include children of day nodes
./bin/run.js node get --path "📆 Calendar" --depth 5 --json --fields id,name,children
```

Navigate to: `Calendar → {YEAR} → {MONTH} → {day} → first child`

If the first child is empty (`name: ""`), that's the "today" capture point.

## Creating Items Under Today

To add an item under today's date:

1. First, find or create the day node (see calendar-dates skill)
2. Create the item as a child of the day node:

```bash
./bin/run.js node create \
  --parent-id <DAY_NODE_ID> \
  --name "Your item text" \

```

## Related Skills

- **calendar-dates** - Creating and finding date nodes with `<time>` format
- **workflowy-backups** - Calendar metadata in backup files (dateId, level fields)
