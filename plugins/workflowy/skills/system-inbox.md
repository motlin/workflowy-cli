---
description: The Workflowy system Inbox node for quick capture. Use this as the default destination for /capture commands.
---

# System Inbox Node

Workflowy automatically creates a special `Inbox` node for every user. This is the default quick-capture destination.

## System Inbox Properties

| Property      | Value                        |
| ------------- | ---------------------------- |
| Name          | `Inbox` (exact, no emoji)    |
| Created by    | Workflowy (not user-created) |
| Always exists | Yes                          |
| Location      | Root level                   |

## Accessing the System Inbox

The System Inbox can be accessed using the `inbox` system target via `--parent-id`:

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

```bash
# Read the System Inbox
./bin/run.js node get --path "Inbox" --depth 1

# Create an item in the System Inbox using system target
./bin/run.js node create --parent-id inbox --name "Quick capture item"
```

## Quick Capture Pattern

For `/capture` commands, use `--parent-id inbox` (preferred method):

```bash
./bin/run.js node create \
  --parent-id inbox \
  --name "$ITEM_TEXT" \

```

This is more reliable than `--parent-path "Inbox"` because the API accepts `inbox` as a target key directly.

This mirrors what happens when users press `i` in Workflowy (quick add to inbox).

## System Inbox vs GTD Inboxes

| Node         | Name                | Purpose                                    |
| ------------ | ------------------- | ------------------------------------------ |
| System Inbox | `Inbox`             | Workflowy's built-in quick capture         |
| GTD Inbox    | `📥 Inbox` (varies) | User-created GTD inbox under Personal/Work |

The System Inbox is ideal for quick capture because:

- It always exists (no configuration needed)
- It has a fixed, known path
- It matches Workflowy's native quick-add behavior

GTD Inboxes (like `Personal > 📥 Inbox`) are better for:

- Context-specific capture (work vs personal)
- Integration with GTD workflow and processing

## Related Skills

- **system-calendar** - The other Workflowy system node
- **capture-provenance** - Formatting captured items with source attribution
