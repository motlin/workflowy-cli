---
description: Deprecated legacy quick capture — add a single typed item to the Workflowy inbox with source provenance. Superseded by /gtd:capture (which accepts optional item text); reach for this only when explicitly invoking the legacy command.
---

# GTD Quick Capture

> Legacy command. `/gtd:capture <text>` does the same direct capture; use this only when explicitly asked for the legacy flow.

Capture an item to the inbox.

## Skills

- **system-inbox** - The Workflowy system Inbox node (default destination)
- **capture-provenance** - Format captured items with source attribution

## Arguments

- `$ARGUMENTS` - The text to capture (required)
- `--url <url>` - Source URL to include as a child node (optional)

## Workflow

- Create the item in the System Inbox (path: "Inbox")
- Format the node per capture-provenance skill (source: "User input")
- Create the main node and child nodes per the CLI examples in capture-provenance.md
- Confirm success with the created node's ID and a link to view it

## Examples

```text
/gtd:capture Call dentist
/gtd:capture Buy groceries for weekend
/gtd:capture --url https://example.com/article Read this article later
```
