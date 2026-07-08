---
description: CLI Feedback Walkthrough
---

# CLI Feedback Walkthrough

Walk through oclif CLI commands interactively, gathering user feedback and adding it to the markdown task list.

## Workflow

- Build the CLI if needed: `npm run build`

- Start with the main help menu:

    > Run `./bin/run.js <subcommand> --help` to verify available flags before constructing commands.

    ```bash
    ./bin/run.js --help
    ```

- For each command/topic discovered:
    - Show the command help: `./bin/run.js <command> --help`
    - Ask user if they want to run an example
    - If yes, run the command and show output
    - Ask for feedback on the output
    - For feedback requiring code changes: Add to task list using the markdown-tasks skill
    - For analysis questions: Do the analysis immediately by reading source files

- For each feedback item:
    - If it requires code changes, add to task list using the markdown-tasks skill
    - If it's a question/analysis, investigate the source code immediately

- Guidelines:
    - Ask for confirmation frequently before running commands
    - Only use commands based on actual data seen in earlier output
    - Don't make code changes during feedback collection
    - Add all code change requests to the task list
    - Do analysis tasks immediately (read source, compare implementations)

- At the end:
    - Review the complete list of tasks added to `.llm/todo.md`
    - Summarize what was discovered
    - Mark the feedback collection session as complete in TodoWrite

## Key Principles

- **Use the markdown-tasks skill** for all task list management
- **Named flags over positional arguments** - Prefer explicit `--flag value` over positional args
- **Color coding** - Use consistent color schemes for similar concepts across commands
- **No N+1 queries** - Make API calls opt-in unless necessary
- **Cache immutable data** - Data that never changes should be cached
- **Explicit timezones** - Always show timezone in timestamps
- **Right-align numbers** - Better readability in tables
- **Blank over dash** - Use blank space for zero values, not `-`
