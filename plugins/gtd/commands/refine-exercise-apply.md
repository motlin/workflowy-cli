---
name: refine-exercise-apply
description: 'Apply half of #exercise formatting — read the staged .llm/gtd/review/proposals/refine-exercise.json, walk the batched AskUserQuestion confirmation loop, apply accepted node updates, then advance the refine-exercise review date.'
---

# Refine #exercise — Apply

The interactive half of the exercise-formatting split. It reads what `refine-exercise-prep` staged and walks the user through confirmations — no formatting rules live here. Mirrors `refine-journal-apply`.

## Prerequisite

Run `/gtd:refine-exercise-prep` first (in the daily review it runs automatically as the last link of the Phase 0 `🔗 Calendar journal — serial chain`, after `refine-journal-prep`). It stages `.llm/gtd/review/proposals/refine-exercise.json`.

## Presentation order

In the daily review's `🙋 Presentation` group, this task's node is placed **below** `Refine calendar journal · apply`, so the walk presents it **after** refine-journal. That keeps the user reviewing each entry's tags (refine-journal) before its formatting (exercise), and guarantees the `before` text shown here reflects refine-journal's already-applied edits rather than stale pre-refine text.

## Do not use the built-in task list

Track progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror per-entry work. Launching subagents via the `Task` tool is unrelated and fine.

## Run the shared apply routine

Follow the **Shared Apply Routine** in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` for key `refine-exercise` — read the staged file, branch on `status`, batch-present `proposals[]` in batches of up to 4 via `AskUserQuestion`, and apply each batch's accepted `applyOps` verbatim before presenting the next. The skill is authoritative for the presentation format, the Accept / Reject / Accept-with-note options, ambiguity handling, and shell escaping.

- On `status: "empty"`, still advance the review date (prep ran and found every entry already canonical), then stop.
- On `status: "needs-interactive"` or `"error"`, fall back to running the full formatting pass inline (scan the month's `#exercise` entries, normalize per the rules in `${CLAUDE_PLUGIN_ROOT}/commands/refine-exercise-prep.md`, propose in batches), then advance the date.

## Advance progress (apply only)

After the last batch, dispatch a **background** date-write to advance the refine-exercise task node's review date per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md` (interval mapping + `<time>` format + drain protocol), using `taskNodeId` from the staged file. Advancing only on apply — never in prep — means an aborted prep never skips a day.

## Summary

Output a brief summary folded into the daily review:

- Month applied
- Total `#exercise` entries reviewed (from `summary.entriesReviewed`)
- Total entries reformatted / skipped

## Idempotency

A re-run after a completed apply reads `status: "empty"` (prep found nothing new) and skips without re-applying. Never run the same `applyOps` twice.
