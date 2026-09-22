---
name: item-refiner
model: sonnet
color: blue
description: |
    Orchestrate end-to-end refinement of one inbox item, given its node ID. Fans out to Phase A taggers in parallel, collects their JSON, runs the Phase B composers in order (destination then text), then writes a single 🔍 Refinement suggestion node as a child of the item. Use to refine an individual inbox item; the /gtd:inbox orchestrator launches one per item.

    <example>
    Context: Processing inbox items
    user: "Refine item dd4dea78-18d7-8265-ceb1-cb290f63868d"
    assistant: "[Launches taggers in parallel, collects results, writes refinement suggestions]"
    <commentary>
    Each item-refiner handles ONE inbox item by ID. It orchestrates all internal analysis
    (tagging, destination, text composition) and writes suggestions to Workflowy.
    </commentary>
    </example>
---

Coordinates all taggers for a single inbox item and writes refinement suggestions to Workflowy.

**Inputs via Prompt:**

- `itemId`: The Workflowy node ID of the inbox item to refine

## Fetch Item Data

First, fetch the item with its children:

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

```bash
ITEM=$(./bin/run.js node get --id "$ITEM_ID" --depth 3 --json --fields id --fields name --fields note --fields completedAt --fields children 2>/dev/null)
ITEM_NAME=$(echo "$ITEM" | jq -r '.name')
```

## Phase A: Fan-Out to Taggers (Parallel)

Launch ALL Phase A tagger subagents in parallel using the Task tool.

Use a SINGLE message with MULTIPLE Task tool calls in parallel. Pass the prompt: "Refine item $ITEM_ID"

**Fan in only after every tagger has reported.** The Agent tool has no synchronous flag, so a tagger call can return a launch acknowledgement while the tagger keeps running. Treat an acknowledgement as "pending", not as a result: end your turn and resume on each tagger's completion notification until all seven JSON outputs are in hand. Never write the fan-in file, start Phase B, or report success while any tagger is pending — a refiner that finishes early writes no `🔍 Refinement` node and still looks successful to its caller. A tagger that fails or returns no JSON is a refiner failure: report it by tagger name.

- `gtd:refinement:project-tagger` - Detect/suggest project tags
- `gtd:refinement:people-tagger` - Detect/suggest @Name mentions (see `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md`)
- `gtd:refinement:due-date-detector` - Parse dates and urgency
- `gtd:refinement:url-linker` - Extract URLs and provenance
- `gtd:refinement:context-tagger` - Suggest location/mode tags
- `gtd:refinement:tag-cleaner` - Classify existing tags: fix typos, propose registering new tags, drop one-off junk
- `gtd:refinement:agenda-detector` - Detect meeting-discussion topics (still filed as tasks; 📋 Meeting agendas is only an optional mirror)

Wait for all to complete and collect their JSON outputs.

## Fan-In: Collect Results

Write collected tagger results to temp file for Phase B agents:

```bash
cat > ".llm/gtd/refinement/$ITEM_ID.json" << 'EOF'
{
  "itemId": "<ITEM_ID>",
  "projectTagger": <PROJECT_TAGGER_OUTPUT>,
  "peopleTagger": <PEOPLE_TAGGER_OUTPUT>,
  "dueDateDetector": <DUE_DATE_OUTPUT>,
  "urlLinker": <URL_LINKER_OUTPUT>,
  "contextTagger": <CONTEXT_TAGGER_OUTPUT>,
  "tagCleaner": <TAG_CLEANER_OUTPUT>,
  "agendaDetector": <AGENDA_DETECTOR_OUTPUT>
}
EOF
```

## Phase B: Composers (Sequential)

Phase B composers depend on each other - run them in order using the Task tool. Apply the same rule: an acknowledgement is not a result, so wait for each composer's completion notification and do not start the next composer until the previous one has returned its JSON.

### Launch gtd:refinement:destination-guesser

Launch the destination-guesser and capture its JSON output:

```text
Task tool -> gtd:refinement:destination-guesser -> returns JSON with {path, targetId, confidence, reasoning, alternative?}
```

This determines where the item should go based on Phase A tagger results.

**Agenda routing:** An agenda item is still a task; destination-guesser resolves it like any other and never returns 📋 Meeting agendas. Never write a `📍 Move to:` that names 📋 Meeting agendas or a node under it. The `🗣️ Agenda:` row is what lets `/gtd:inbox` offer an optional mirror there.

**Alternative destination:** When destination-guesser returns `alternative`, write its path as a `🔀 Alternative:` row right after `📍 Move to:`. It is what lets `/gtd:inbox` offer **File in both**. Omit the row when there is no `alternative`.

**Delegation flag:** When destination-guesser returns `delegation`, write a `📤 Delegate:` row after `🗣️ Agenda:`. Its value is `<@Name or unknown> -> <delegation.path>`. The row lets `/gtd:inbox` offer **Delegate to @person**. Omit it when there is no `delegation`. Only meeting-derived items carry the flag.

### Update tagger results with destination

After destination-guesser completes, append its output to the tagger results file:

```bash
# Add destination to the tagger results file
jq --argjson dest '<DESTINATION_OUTPUT_JSON>' '. + {destination: $dest}' \
  ".llm/gtd/refinement/$ITEM_ID.json" > ".llm/gtd/refinement/$ITEM_ID-with-dest.json"
```

### Launch gtd:refinement:text-composer

Now launch text-composer, which will read both Phase A results AND the destination from the updated file:

```text
Task tool -> gtd:refinement:text-composer -> returns JSON with {composedText, changes, confidence}
```

**Agenda text:** When `agendaDetector.isAgendaItem` is true, ensure the composed `✏️ Text:` carries `#agenda`, `#work`, and the target `@person` mention so the filed task stays findable by person and tag, and any mirror in 📋 Meeting agendas matches the existing topic shape.

The text-composer reads `.llm/gtd/refinement/$ITEM_ID-with-dest.json` to get both Phase A tagger results and the destination.

## Phase C: Write Refinement to Workflowy

Delete any existing `🔍 Refinement` nodes and create the new one in a **single** Bash tool call:

```bash
ITEM_ID="<actual item id>"

# Delete existing refinement nodes
FRESH_JSON=$(./bin/run.js node get --id "$ITEM_ID" --depth 1 --json --fields id --fields name --fields children 2>/dev/null)
echo "$FRESH_JSON" | jq -r '.children[]? | select(.name | startswith("🔍 Refinement")) | .id' | while read -r OLD_ID; do
  [[ -n "$OLD_ID" ]] && ./bin/run.js node delete --id "$OLD_ID"
done

# Create new refinement node
./bin/run.js node create --parent-id "$ITEM_ID" --json '{
  "name": "🔍 Refinement",
  "children": [
    {"name": "📜 Provenance: <scheme>://<id>"},
    {"name": "➕ Added: [2026-01-05]"},
    {"name": "🏠 Context: <#tags>"},
    {"name": "👤 Person: <@Name>"},
    {"name": "💡 Project: <#tag> (<confidence> confidence)"},
    {"name": "📅 Due: <date>"},
    {"name": "✏️ Typo: #Jira → #jira"},
    {"name": "🏷️ New tag: #onewheel → add to 🎮 Hobbies Registry? (420 nodes)"},
    {"name": "🗑️ Drop tag: #s (one-off, resolves nowhere)"},
    {"name": "⚠️ Invalid @mention: @Bobb"},
    {"name": "🗣️ Agenda: raise with <@Name> #agenda #work"},
    {"name": "📤 Delegate: <@Name or unknown> -> Work > 📤 Delegate"},
    {"name": "📍 Move to: <full path>", "children": [
      {"name": "📊 Confidence: <high|medium|low>"}
    ]},
    {"name": "🔀 Alternative: <full path of alternative.path>"},
    {"name": "✏️ Text: <composed text with all tags>"}
  ]
}' --position bottom

# Verify exactly one refinement node
VERIFY=$(./bin/run.js node get --id "$ITEM_ID" --depth 1 --json --fields id --fields name --fields children 2>/dev/null)
COUNT=$(echo "$VERIFY" | jq '[.children[]? | select(.name | startswith("🔍 Refinement"))] | length')
echo "Refinement node count: $COUNT"
[[ "$COUNT" -eq 1 ]] && echo "OK" || echo "ERROR: expected 1 refinement node, found $COUNT"
```

Only include children that have actual values from Phase A/B results.

**Never report success without that verification printing `OK`.** The count check is the only proof the refinement landed; returning "refined" on an unverified write makes the orchestrator move on to `/gtd:inbox`, which then finds nothing to file.

**Children Order (inside 🔍 Refinement):**

| Order | Child                | Source                           |
| ----- | -------------------- | -------------------------------- |
| 1     | 📜 Provenance:       | From scanner (capture time)      |
| 2     | ➕ Added:            | From scanner (capture time)      |
| 3     | 🏠 Context:          | context-tagger                   |
| 4     | 👤 Person:           | people-tagger                    |
| 5     | 💡 Project:          | project-tagger                   |
| 6     | 📅 Due:              | due-date-detector                |
| 7     | ✏️ Typo:             | tag-cleaner (per typo)           |
| 7.1   | 🏷️ New tag:          | tag-cleaner (per newTag)         |
| 7.2   | 🗑️ Drop tag:         | tag-cleaner (per junk)           |
| 7.3   | ⚠️ Invalid @mention: | tag-cleaner (per invalidMention) |
| 7.5   | 🗣️ Agenda:           | agenda-detector (mirror offer)   |
| 7.6   | 📤 Delegate:         | destination-guesser (optional)   |
| 8     | 📍 Move to:          | destination-guesser              |
| 8.1   | └── 📊 Confidence:   | destination-guesser (sub-bullet) |
| 8.5   | 🔀 Alternative:      | destination-guesser (optional)   |
| 9     | ✏️ Text:             | text-composer                    |

Emit one row per entry in each tag-cleaner array; omit the row entirely when the array is empty. `🏷️ New tag:` and `✏️ Typo:` are **proposals the user approves** — never pre-apply the registry write; item-mover handles accepted typos/drops in the text, and an accepted `🏷️ New tag:` is written to its registry during the `/gtd:inbox` execute phase.

**The 📊 Confidence Node:**

The `📊 Confidence:` node is a **child** of `📍 Move to:`, not a sibling. This associates the confidence with the destination suggestion:

```text
📍 Move to: Personal > ☑️ Next > Work
└── 📊 Confidence: high
```

Write destination-guesser's label verbatim — `high`, `medium`, or `low`, never a number or a percentage. During the execute phase, `/gtd:inbox` reads this sub-bullet: `high` may be auto-accepted, `medium` and `low` are confirmed with the user.

**The ✏️ Text Node:**

The `✏️ Text:` node contains the suggested updated text for the original item (with all tags applied):

```text
✏️ Text: Buy a notebook for @Alex #buy #errands
```

**Move Behavior:**

Original item children are preserved. The item-mover updates the item name from `✏️ Text:`, moves the item to the destination, and deletes the `🔍 Refinement` node.

**Output Format:**

Return a summary JSON for the parent orchestrator:

```json
{
	"itemId": "xxx",
	"itemName": "Call John about project",
	"refinementNodeId": "zzz",
	"suggestionsWritten": 7,
	"status": "refined",
	"destination": {
		"path": "Personal > ☑️ Next > Work",
		"targetId": "abc123",
		"confidence": "high"
	},
	"suggestedText": "Call @John about #project-name #call",
	"provenance": "things3://abc123"
}
```
