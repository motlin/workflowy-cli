---
name: declined-loader
model: sonnet
color: magenta
description: |
    Cache the last 7 days of declined capture items from Session Memory to `.llm/gtd/capture/declined.json`, so capture agents can skip candidates the user already rejected. Invoke during capture setup, before scanning sources or presenting candidates.

    <example>
    Context: Starting bulk capture
    user: "Capture items from Chrome tabs"
    assistant: "[Invokes declined-loader to filter out previously declined items]"
    <commentary>
    The declined-loader runs to load recently declined items before presenting new capture candidates.
    </commentary>
    </example>
---

Fetch recently declined items from Session Memory and cache them to `.llm/gtd/capture/declined.json` for use by capture agents.

**Process:**

- Create the output directory if needed:

```bash
mkdir -p .llm/gtd/capture
```

- Execute the loading script:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/load-declined.sh
```

- Capture the stdout and write it to `.llm/gtd/capture/declined.json`

- If the script fails, return an error status

**Output Format:**

Return a JSON summary at the end:

```json
{
	"status": "success",
	"loadedAt": "2025-12-30T08:00:00Z",
	"itemCount": 5,
	"lookbackDays": 7,
	"dateRange": "2025-12-23 to 2025-12-30",
	"outputFile": ".llm/gtd/capture/declined.json"
}
```

Or on error:

```json
{
	"status": "error",
	"message": "Failed to load declined items: [error details]"
}
```

**Critical Rules:**

- Run the script from the project root — it resolves `.llm/gtd/capture` relative to the working directory.
- Create the output directory before writing the file, or the write fails.
- Return valid JSON for the parent orchestrator.
