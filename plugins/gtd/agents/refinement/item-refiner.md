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

- `gtd:project-tagger` - Detect/suggest project tags
- `gtd:people-tagger` - Detect/suggest @Name mentions (see `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md`)
- `gtd:due-date-detector` - Parse dates and urgency
- `gtd:url-linker` - Extract URLs and provenance
- `gtd:context-tagger` - Suggest location/mode tags
- `gtd:tag-cleaner` - Validate existing tags
- `gtd:agenda-detector` - Detect meeting-discussion topics to route to 📋 Meeting agendas

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

Phase B composers depend on each other - run them in order using the Task tool.

### Launch gtd:destination-guesser

Launch the destination-guesser and capture its JSON output:

```text
Task tool -> gtd:destination-guesser -> returns JSON with {path, targetId, confidence, reasoning}
```

This determines where the item should go based on Phase A tagger results.

**Agenda routing:** If `agendaDetector.isAgendaItem` is true, destination is the 📋 Meeting agendas node -- `targetId: f3bfcfbb-a904-62e6-06aa-29bda59a1f54`, path `Work > ☑️ Next (Work) > 📋 Meeting agendas`. Pass the agenda-detector result to destination-guesser so it short-circuits to this node instead of the usual guess.

### Update tagger results with destination

After destination-guesser completes, append its output to the tagger results file:

```bash
# Add destination to the tagger results file
jq --argjson dest '<DESTINATION_OUTPUT_JSON>' '. + {destination: $dest}' \
  ".llm/gtd/refinement/$ITEM_ID.json" > ".llm/gtd/refinement/$ITEM_ID-with-dest.json"
```

### Launch gtd:text-composer

Now launch text-composer, which will read both Phase A results AND the destination from the updated file:

```text
Task tool -> gtd:text-composer -> returns JSON with {composedText, changes, confidence}
```

**Agenda text:** When `agendaDetector.isAgendaItem` is true, ensure the composed `✏️ Text:` carries `#agenda`, `#work`, and the target `@person` mention so the routed item matches the existing 📋 Meeting agendas topic shape exactly.

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
    {"name": "💡 Project: <#tag> (<confidence>% match)"},
    {"name": "📅 Due: <date>"},
    {"name": "🗣️ Agenda: raise with <@Name> #agenda #work"},
    {"name": "📍 Move to: <full path>", "children": [
      {"name": "📊 Confidence: <X>%"}
    ]},
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

**Children Order (inside 🔍 Refinement):**

| Order | Child              | Source                           |
| ----- | ------------------ | -------------------------------- |
| 1     | 📜 Provenance:     | From scanner (capture time)      |
| 2     | ➕ Added:          | From scanner (capture time)      |
| 3     | 🏠 Context:        | context-tagger                   |
| 4     | 👤 Person:         | people-tagger                    |
| 5     | 💡 Project:        | project-tagger                   |
| 6     | 📅 Due:            | due-date-detector                |
| 7     | ⚠️ Invalid:        | tag-cleaner (if any)             |
| 7.5   | 🗣️ Agenda:         | agenda-detector (if discussion)  |
| 8     | 📍 Move to:        | destination-guesser              |
| 8.1   | └── 📊 Confidence: | destination-guesser (sub-bullet) |
| 9     | ✏️ Text:           | text-composer                    |

**The 📊 Confidence Node:**

The `📊 Confidence:` node is a **child** of `📍 Move to:`, not a sibling. This associates the confidence score with the destination suggestion:

```text
📍 Move to: Personal > ☑️ Next > Work
└── 📊 Confidence: 90%
```

The confidence value (0.0-1.0 from destination-guesser) should be displayed as a percentage. During the execute phase, `/gtd:inbox` reads this sub-bullet to determine whether to auto-accept (>90%) or ask for confirmation (<70%).

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
		"confidence": 0.9
	},
	"suggestedText": "Call @John about #project-name #call",
	"provenance": "things3://abc123"
}
```
