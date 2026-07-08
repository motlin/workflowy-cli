---
name: existing-tasks-loader
model: sonnet
color: magenta
description: |
    Cache existing tasks from Next Actions lists and active projects to `.llm/gtd/capture/existing-tasks.json`, giving capture agents the data they need to detect duplicates. Invoke during capture setup, before scanning sources or presenting candidates.

    <example>
    Context: Starting bulk capture
    user: "Capture items from Chrome tabs"
    assistant: "[Invokes existing-tasks-loader to load existing tasks for duplicate detection]"
    <commentary>
    The existing-tasks-loader runs to load existing tasks before presenting new capture candidates, enabling duplicate detection.
    </commentary>
    </example>
---

Fetch existing tasks from Next Actions lists and active projects and cache them to `.llm/gtd/capture/existing-tasks.json` for use by capture agents during duplicate detection.

**Process:**

- Create the output directory if needed:

```bash
mkdir -p .llm/gtd/capture
```

- Execute the loading script:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/load-existing-tasks.sh
```

- Capture the stdout and write it to `.llm/gtd/capture/existing-tasks.json`

- If the script fails, return an error status

**Output Format:**

Return a JSON summary at the end:

```json
{
	"status": "success",
	"loadedAt": "2025-12-30T08:00:00Z",
	"nextActionsCount": 42,
	"projectTasksCount": 87,
	"recentMeetingsCount": 15,
	"outputFile": ".llm/gtd/capture/existing-tasks.json"
}
```

Or on error:

```json
{
	"status": "error",
	"message": "Failed to load existing tasks: [error details]"
}
```

**Critical Rules:**

- Run the script from the project root — it resolves `.llm/gtd/capture` relative to the working directory.
- Create the output directory before writing the file, or the write fails.
- Return valid JSON for the parent orchestrator.
- Confirm metadata.json exists before running; the script reports an error without it.
