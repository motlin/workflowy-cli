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
- subagent_type: "gtd:refinement:inbox-loader"
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
    ├── 🗣️ Agenda: raise with @JohnSmith #agenda #work   <- only on agenda topics
    ├── 📍 Move to: Personal > ☑️ Next > Work
    │   └── 📊 Confidence: high
    └── ✏️ Text: Call @JohnSmith about #home-renovation #call
```

For each item, extract `refinementNodeId`, `destinationPath` (from `📍 Move to:`), `confidence` (from `📊 Confidence:` sub-child), `suggestedText` (from `✏️ Text:`), `provenance` (from `📜 Provenance:`), and `isAgenda` (true when a `🗣️ Agenda:` row exists). Write the array to `.llm/gtd-parsed-items.json`.

**Handling missing data:**

- No `📍 Move to:` -> Skip item (cannot move without destination)
- No `📊 Confidence:` -> Treat as `low` confidence
- No `✏️ Text:` -> Keep original item text
- No `📜 Provenance:` -> Set to null
- `📍 Move to:` names `📋 Meeting agendas` (`f3bfcfbb-a904-62e6-06aa-29bda59a1f54`) or a node under it -> an older refinement; replace it with the bottom tier of the Work `📌 Tasks (asap)` ladder (per `${CLAUDE_PLUGIN_ROOT}/skills/asap-tiers.md`) and mark the item `isAgenda`

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

Never offer Someday as an option, and never suggest it when the user picks "Other". An undated future task ("read this in the future", "maybe look into X") is still a task — its destination is the bottom tier of the matching `📌 Tasks (asap)` ladder. When a `📍 Move to:` suggestion names a Someday node, replace it with that bottom tier before presenting the item.

```text
Question: "'Buy groceries' -> ☑️ Next Actions (medium confidence)"

Options:
- "Accept" (☑️ Next Actions)
- "Skip (leave in inbox)"
- "Delete"
```

**Never file an item only into 📋 Meeting agendas.** A topic that lives only there gets lost, because nothing but a meeting ever surfaces it. Every agenda item is filed as a task, on its asap tier or in the due-dates bucket, carrying `#agenda` and the `@person`; that tag is often enough on its own. Never offer `📋 Meeting agendas` as a destination. When the item is `isAgenda`, add one extra option after Accept:

- **Accept + agenda mirror** — file the task to the suggested tier as Accept does, then add a companion node under `📋 Meeting agendas` that points back to it.

When the user picks "Other" and names 📋 Meeting agendas, treat it as Accept + agenda mirror.

The Workflowy API cannot create a live mirror, so the companion is a link. After item-mover has moved the task, create it under the Work `📋 Meeting agendas` node with the task's short ID (last 12 hex chars of its UUID), per `plugins/workflowy/skills/workflowy-html.md`:

```bash
./bin/run.js node create --parent-id f3bfcfbb-a904-62e6-06aa-29bda59a1f54 \
  --name '<a href="https://workflowy.com/#/<SHORT_ID>">Ask @Bob about build server permissions</a> #agenda' \
  --position bottom
```

The user can swap the link for a real Workflowy mirror by hand if they prefer.

**Do it now.** When an item is something Claude can finish entirely as Workflowy edits through the CLI (rename, move, tag, or complete an existing node; create or restructure nodes; delete a stale node), add a **Do it now** option and list it first, ahead of Accept. Describe the concrete edits in the option description so the user knows what will happen. Do not offer it when the item needs anything outside Workflowy (email, calendar, web, purchases, a phone call) or a decision only the user can make.

```text
Question: "'Rename the 🏗️ Home project to 🏡 House' -> ☑️ Next Actions (high confidence)"

Options:
- "Do it now" (rename node 🏗️ Home -> 🏡 House, then remove this inbox item)
- "Accept" (☑️ Next Actions)
- "Skip (leave in inbox)"
- "Delete"
```

When the user picks Do it now, perform the edits immediately through the CLI, never by writing SQLite. Verify each edited node with `./bin/run.js node get --id <nodeId>`. Then delete the inbox item with `./bin/run.js node delete --id <itemId>`. If any edit fails, leave the inbox item in place and report the failure. Count these as "done" in the running total.

**After each batch of 4 reviews, execute immediately:**

- **Do it now**: Already performed when chosen (see above); nothing left to execute
- **Deletes**: Run `./bin/run.js node delete --id <itemId>` directly
- **Moves**: Launch item-mover agent with the batch's confirmed moves
- **Accept + agenda mirror**: Include the item in the batch's moves, then create its `📋 Meeting agendas` link node once item-mover returns
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
- subagent_type: "gtd:refinement:item-mover"
  prompt: |
    Execute confirmed moves:
    <JSON array of confirmed moves for this batch>
```

**Running total**: After each batch, show a running summary:

```text
Batch 3 complete: 1 done, 1 moved, 1 deleted, 1 skipped (12/73 processed)
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
