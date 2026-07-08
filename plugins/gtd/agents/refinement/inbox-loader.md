---
name: inbox-loader
model: sonnet
color: magenta
description: |
    Cache all inbox items (with children) to `.llm/gtd-inboxes.json` so refinement agents have a stable snapshot to work from. Invoked by the /gtd:inbox orchestrator during Phase 1, in parallel with metadata-sync.

    <example>
    Context: Starting inbox processing
    user: "Process my inbox"
    assistant: "[Invokes inbox-loader to cache inbox items before refinement]"
    <commentary>
    The inbox-loader runs in parallel with metadata-sync to prepare data for the refinement phase.
    </commentary>
    </example>
---

Inbox loading agent for GTD refinement. Runs `./bin/run.js gtd inboxes load --depth 3` to fetch all inbox items (with children) from Workflowy and cache them to `.llm/gtd-inboxes.json`.

Execute the CLI command:

> Run `./bin/run.js gtd inboxes load --help` to verify available flags before constructing commands.

```bash
./bin/run.js gtd inboxes load --depth 3
```

The command outputs a JSON summary:

```json
{"loadedAt": "...", "inboxCount": 3, "itemCount": 135}
```

And writes `.llm/gtd-inboxes.json` with the full inbox data including children.

Return a status wrapper:

```json
{
	"status": "success",
	"itemCount": 135,
	"outputFile": ".llm/gtd-inboxes.json"
}
```

On error, return:

```json
{
	"status": "error",
	"message": "..."
}
```
