---
description: Child-node structure for GTD inbox items — the provenance, added-date, refinement, destination, and final-node children that record where a captured item came from and what happens when it is confirmed. Use whenever capturing or refining an inbox item: creating the 📜 Provenance and ➕ Added children at capture time, adding 🏠 Context / 👤 Person / 💡 Project / 📅 Due refiners, composing the 📍 Move to and 📋 Final nodes, or deciding how to delete an item from its source after confirmation.
---

# Capture Provenance

Every captured inbox item includes children documenting its source, capture time, refinement suggestions, and the final proposed node. These children provide transparency about where the item came from and what will happen when confirmed.

## Full Structure

After capture and refinement, an inbox item looks like this:

```text
Buy pencil case for Alice
├── 📜 Provenance: things3://DJHa8FkpUnPSwBSKVZMWqw
├── ➕ Added: <time startYear="2026" startMonth="1" startDay="5">Mon, Jan 5, 2026</time>
├── 🏠 Context: #buy #errands
├── 👤 Person: @Alice
├── 💡 Project: (none)
├── 📍 Move to: Personal > ☑️ Next > 📌 Tasks (asap)
└── 📋 Final
    └── Buy a pencil case for @Alice #buy #errands
```

## Children Order

The order reflects when information is known:

| Order | Child            | When Known   | Purpose                             |
| ----- | ---------------- | ------------ | ----------------------------------- |
| 1     | 📜 Provenance    | Capture time | Source identifier for deletion      |
| 2     | ➕ Added         | Capture time | When captured                       |
| 3-N   | Phase A refiners | Refinement   | Context, Person, Project, Due, etc. |
| N+1   | 📍 Move to       | Phase B      | Destination path or link            |
| Last  | 📋 Final         | Phase B      | The actual node to be moved         |

## Required Children (Capture Time)

| Child | Format | Example |
| --- | --- | --- |
| Provenance | `📜 Provenance: <scheme>://<id>` | `📜 Provenance: things3://DJHa8FkpUnPSwBSKVZMWqw` |
| Added | `➕ Added: <time ...>` | `➕ Added: <time startYear="2026" startMonth="1" startDay="5">Mon, Jan 5, 2026</time>` |

## Provenance Schemes

Each source system defines its own identifier scheme:

| Scheme         | Source          | Example                            | Deletion Support |
| -------------- | --------------- | ---------------------------------- | ---------------- |
| `things3://`   | Things 3        | `things3://DJHa8FkpUnPSwBSKVZMWqw` | Yes              |
| `chrome://`    | Chrome tab      | `chrome://tab-id`                  | Close tab        |
| `github://`    | GitHub PR       | `github://owner/repo/123`          | No               |
| `gmail://`     | Gmail           | `gmail://message-id`               | Archive          |
| `imessage://`  | iMessage        | `imessage://guid`                  | No               |
| `git://`       | Git repo        | `git://repo-path`                  | No               |
| `reminders://` | Apple Reminders | N/A (no ID exposed)                | Manual only      |

Sources without deletion support require manual cleanup in the source system.

## Refinement Children (Phase A)

Added by refinement agents after capture:

| Child   | Format                   | Example                        |
| ------- | ------------------------ | ------------------------------ |
| Context | `🏠 Context: <tags>`     | `🏠 Context: #buy #errands`    |
| Person  | `👤 Person: <@name>`     | `👤 Person: @Alice`            |
| Project | `💡 Project: <#project>` | `💡 Project: #home-renovation` |
| Due     | `📅 Due: <date>`         | `📅 Due: Fri, Jan 10, 2026`    |

## Destination and Final (Phase B)

| Child   | Format                     | Example                                            |
| ------- | -------------------------- | -------------------------------------------------- |
| Move to | `📍 Move to: <path>`       | `📍 Move to: Personal > ☑️ Next > 📌 Tasks (asap)` |
| Final   | `📋 Final` with child node | See below                                          |

The `📋 Final` node contains the actual node that will be moved:

```text
└── 📋 Final
    └── Buy a pencil case for @Alice #buy #errands
        └── (any children the final node needs)
```

This is WYSIWYG - the child of `📋 Final` IS the node, fully formed. At confirmation:

- The child node is moved to the destination
- Source item is deleted using the Provenance identifier
- Original inbox item (now empty) is deleted

## Date Format

Use Workflowy's native `<time>` element:

```html
<time
	startYear="YYYY"
	startMonth="M"
	startDay="D"
	>Day, Mon DD, YYYY</time
>
```

Do not zero-pad month or day — Workflowy expects `1`, not `01`.

## Node Structure Examples

Simple capture (before refinement):

```text
- Call dentist to schedule cleaning
  - 📜 Provenance: user://input
  - ➕ Added: <time startYear="2026" startMonth="1" startDay="5">Mon, Jan 5, 2026</time>
```

After refinement:

```text
- Call dentist to schedule cleaning
  - 📜 Provenance: user://input
  - ➕ Added: <time startYear="2026" startMonth="1" startDay="5">Mon, Jan 5, 2026</time>
  - 🏠 Context: #calls #health
  - 👤 Person: (none)
  - 💡 Project: (none)
  - 📍 Move to: Personal > ☑️ Next > 📌 Tasks (asap)
  - 📋 Final
    - Call dentist to schedule cleaning #calls #health
```

From Things 3:

```text
- Buy pencil case for Alice
  - 📜 Provenance: things3://DJHa8FkpUnPSwBSKVZMWqw
  - ➕ Added: <time startYear="2026" startMonth="1" startDay="5">Mon, Jan 5, 2026</time>
  - 🏠 Context: #buy #errands
  - 👤 Person: @Alice
  - 💡 Project: (none)
  - 📍 Move to: Personal > ☑️ Next > 📌 Tasks (asap)
  - 📋 Final
    - Buy a pencil case for @Alice #buy #errands
```

## Notes Field

The `--note` field is reserved for verbatim quotes from original source material. All metadata must be child nodes, not notes.

## Related Skills

- **system-inbox** - Default capture destination
- **calendar-dates** - Workflowy native date format details
