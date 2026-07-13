---
name: refine-exercise-apply
description: 'Apply staged #exercise formatting updates and return a verified result to the daily-review scheduler.'
---

# Refine #exercise — Apply

The interactive half of the exercise-formatting split. It reads what `refine-exercise-prep` staged and walks the user through confirmations — no formatting rules live here. Mirrors `refine-journal-apply`.

## Prerequisite

Run `/gtd:refine-exercise-prep` first. In the daily review it is the last task in `Serial: Calendar journal`, after `refine-journal-prep`. It stages `.llm/gtd/review/proposals/refine-exercise.json`.

## Presentation order

Under `Presentation`, this task is below `Refine calendar journal`, so the walk presents it after refine-journal. That keeps tag review ahead of formatting and ensures the displayed `before` text reflects accepted refinement edits.

## Do not use the built-in task list

Track progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror per-entry work. Launching subagents via the `Task` tool is unrelated and fine.

## Run the shared apply routine

Follow the **Shared Apply Routine** in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` for slug `refine-exercise` — read the staged file, branch on `status`, batch-present `proposals[]` in batches of up to 4 via `AskUserQuestion`, and apply each batch's accepted `applyOps` verbatim before presenting the next. The skill is authoritative for the presentation format, the Accept / Reject / Accept-with-note options, ambiguity handling, and shell escaping.

- On `status: "empty"`, return empty without prompting.
- On `status: "needs-interactive"`, run the full formatting pass inline and return success after verification.
- On `status: "error"`, surface the error and return failure.

## Return progress

Return success after the last verified batch, or empty when no changes were needed. The DAG executor owns the prep date.

## Summary

Output a brief summary folded into the daily review:

- Month applied
- Total `#exercise` entries reviewed (from `summary.entriesReviewed`)
- Total entries reformatted / skipped

## Idempotency

A re-run after a completed apply reads `status: "empty"` (prep found nothing new) and skips without re-applying. Never run the same `applyOps` twice.
