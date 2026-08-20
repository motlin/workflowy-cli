---
description: GTD inbox processing — file refined inbox items (those carrying a 🔍 Refinement suggestion) to their GTD destinations via a batched confirm-and-move loop. Run after /gtd:refine-inbox. Use when the user wants to process, clear, or empty their inbox, or reach inbox zero.
---

# GTD Inbox Processing

Process **refined** items from your inbox following GTD principles. This command handles Phases 3-4 (Synthesize + Execute) for items that already have `🔍 Refinement` suggestions.

**Prerequisite**: Run `/gtd:refine-inbox` first to analyze items and write suggestions.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the phases or per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Workflow

### Load Inbox Data

Launch the inbox-loader agent to get current inbox items:

```text
Task tool:
- subagent_type: "gtd:inbox-loader"
  prompt: "Load all inbox items from Workflowy and cache to .llm/gtd-inboxes.json"
```

Wait for it to complete.

**Check for Inbox Zero:**

```bash
ITEM_COUNT=$(jq '[.inboxes[].items | length] | add' .llm/gtd-inboxes.json)
```

If `ITEM_COUNT` is 0, celebrate "Inbox Zero!" and exit.

### Partition Items by Refinement Status

Partition inbox items into two groups:

- **Refined**: Items WITH a `🔍 Refinement` child node
- **Unrefined**: Items WITHOUT a `🔍 Refinement` child node

```bash
# Get items with refinement children (refined)
jq -c '[
  .inboxes | to_entries[] |
  .key as $inboxIdx |
  .value.name as $inboxName |
  .value.items | to_entries[] |
  select(.value.children | any(.name | startswith("🔍 Refinement"))) |
  {inboxIndex: $inboxIdx, inboxName: $inboxName, itemIndex: .key, item: .value}
]' .llm/gtd-inboxes.json > .llm/gtd-refined-items.json

# Get items without refinement children (unrefined)
jq -c '[
  .inboxes | to_entries[] |
  .key as $inboxIdx |
  .value.name as $inboxName |
  .value.items | to_entries[] |
  select(.value.children | all(.name | startswith("🔍 Refinement") | not)) |
  {inboxIndex: $inboxIdx, inboxName: $inboxName, itemIndex: .key, item: .value}
]' .llm/gtd-inboxes.json > .llm/gtd-unrefined-items.json

REFINED_COUNT=$(jq 'length' .llm/gtd-refined-items.json)
UNREFINED_COUNT=$(jq 'length' .llm/gtd-unrefined-items.json)
```

If `REFINED_COUNT` is 0:

```text
No refined items found in inbox.
Run /gtd:refine-inbox to analyze items and write suggestions.
```

Exit early.

### Parse Refinement Suggestions

For each refined item, parse the suggestions from child nodes.

**Refinement structure:**

```text
Call John about project
├── <original child 1>           <- preserved
├── <original child 2>           <- preserved
└── 🔍 Refinement                <- aggregate node
    ├── 📜 Provenance: user://input
    ├── ➕ Added: <time ...>Mon, Jan 5, 2026</time>
    ├── 🏠 Context: #home #call
    ├── 👤 Person: @JohnSmith (found "John")
    ├── 💡 Project: #home-renovation (high confidence)
    ├── 📅 Due: Fri, Jan 3, 2025
    ├── 📍 Move to: Personal > ☑️ Next > Work
    │   └── 📊 Confidence: high
    └── ✏️ Text: Call @JohnSmith about #home-renovation #call
```

For each item, extract `refinementNodeId`, `destinationPath` (from `📍 Move to:`), `confidence` (from `📊 Confidence:` sub-child), `suggestedText` (from `✏️ Text:`), and `provenance` (from `📜 Provenance:`). Write the array to `.llm/gtd-parsed-items.json`.

**Handling missing data:**

- No `📍 Move to:` -> Skip item (cannot move without destination)
- No `📊 Confidence:` -> Treat as `low` confidence
- No `✏️ Text:` -> Keep original item text
- No `📜 Provenance:` -> Set to null

### Never ask how to file the inbox

**The item count is never grounds to ask.** As soon as the refinement suggestions are parsed, present item 1. Never open with a listing of the proposed moves followed by a presentation-mode question — "How should I file them?", "file all as proposed / walk one at a time / group by destination?", "want me to auto-accept the high-confidence ones?". The batch-of-4 loop below, one `AskUserQuestion` per item, is the only mode.

These openers are all banned, however phrased:

- "Here are the 10 proposed moves — file all as proposed, or walk them one at a time?"
- "Most of these are high confidence; should I just apply those and only ask about the rest?"
- "That's a lot of items — want to do Personal now and Work tomorrow?"
- any "that's a lot" / "this is tedious" editorializing about the count.

Printing a one-line count as context for item 1 is fine. Printing a count _and stopping_ is not.

The only correct first move after parsing the refinement suggestions is to present item 1.

### Review & Execute in Batches (Phases 3-4 interleaved)

**Critical pattern: Review 4 items, then immediately execute moves/deletes for those 4 before reviewing the next batch.** This ensures progress is saved even if the session is interrupted. Never accumulate all decisions before executing.

**For each batch of 4 items, use AskUserQuestion:**

Present each item with its suggested destination and confidence. Always include these option types:

- **Accept** — move to suggested destination
- **Skip** — leave in inbox for later
- **Delete** — remove from inbox entirely
- The "Other" option (auto-added by AskUserQuestion) lets the user specify a different destination or action

```text
Question: "'Buy groceries' -> ☑️ Next Actions (medium confidence)"

Options:
- "Accept" (☑️ Next Actions)
- "Skip (leave in inbox)"
- "Delete"
```

**After each batch of 4 reviews, execute immediately:**

- **Deletes**: Run `./bin/run.js node delete --id <itemId>` directly
- **Moves**: Launch item-mover agent with the batch's confirmed moves
- **Skips**: Do nothing (item stays in inbox)
- **User-specified overrides**: Use the user's custom destination path instead of the suggestion

For moves, item-mover handles:

- Updating the item's text from `✏️ Text:` (if different from original)
- Deleting the `🔍 Refinement` aggregate node (cleanup)
- Moving the original item (with all its children) to the destination

**Build confirmed moves for each batch:**

```json
[
	{
		"itemId": "xxx",
		"refinementNodeId": "zzz",
		"suggestedText": "Call @JohnSmith about #project-name #call",
		"destinationPath": "Personal > ☑️ Next > Work",
		"provenance": "things3://DJHa8FkpUnPSwBSKVZMWqw"
	}
]
```

**Launch item-mover agent per batch:**

```text
Task tool:
- subagent_type: "gtd:item-mover"
  prompt: |
    Execute confirmed moves:
    <JSON array of confirmed moves for this batch>
```

**Running total**: After each batch, show a running summary:

```text
Batch 3 complete: 2 moved, 1 deleted, 1 skipped (12/73 processed)
```

### Summary & Report

After `item-mover` completes, print:

- Processed counts grouped by destination, plus people/projects created.
- Unrefined items by name with a `Run /gtd:refine-inbox` hint, or `Inbox Zero achieved!` if none.

**Log to Session Memory:**

> Run `./bin/run.js node create --help` to verify available flags before constructing commands.

```bash
TODAY=$(date +%Y-%m-%d)

# Log under today's date node, creating it if missing (--create-path is idempotent)
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory,$TODAY" \
  --name "Inbox processed: 5 items moved" --create-path --position bottom
```

If inbox reached zero, log clearing:

```bash
TODAY=$(date +%Y-%m-%d)
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory,$TODAY" \
  --name "inbox-cleared: Personal 📥 Inbox" --create-path --position bottom
```

## Related Commands

- `/gtd:refine-inbox` - Analyze items and write refinement suggestions (Phases 1-2)
- `/gtd:capture` - Capture new items to inbox from external sources
