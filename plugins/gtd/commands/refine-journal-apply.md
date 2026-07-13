---
name: refine-journal-apply
description: Apply staged journal refinements, then advance refine-journal Scanner-State and return a verified result to the daily-review scheduler.
---

# Refine Journal — Apply

The interactive half of the journal refinement split. It reads what `refine-journal-prep` staged and walks the user through confirmations — no matching rules live here. Mirrors how `inbox` applies the `🔍` suggestions that `refine-inbox` wrote.

## Prerequisite

Run `/gtd:refine-journal-prep` first (in the daily review it runs automatically as a Phase 0 prep subagent). It stages `.llm/gtd/review/proposals/refine-journal.json`.

## Do not use the built-in task list

Track progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror per-entry work. (This command advances a Workflowy `Scanner State` node, not the built-in list.) Launching subagents via the `Task` tool is unrelated and fine.

## Run the shared apply routine

Follow the **Shared Apply Routine** in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` for slug `refine-journal` — read the staged file, branch on `status`, batch-present `proposals[]` in batches of up to 4 via `AskUserQuestion`, and apply each batch's accepted `applyOps` verbatim before presenting the next. The skill is authoritative for the presentation format, the Accept / Reject / Accept-with-note options, ambiguity handling, and shell escaping. Two refine-journal specifics:

- On `status: "empty"`, still advance Scanner-State, then return empty. The DAG executor advances the prep date.
- On `status: "needs-interactive"`, run the full interactive refinement inline, then advance state and return success after verification.
- On `status: "error"`, surface the error and return failure.

## Advance progress (apply only)

After the last batch, advance task-specific tracking. This happens only here, never in prep, so an aborted prep never skips a month:

- **Scanner-State** under `Metadata > ⚙️ Scanner State > refine-journal`: read the JSON child, add the completed archive month from `summary.archiveMonth` to `months_completed`, set `last_completed_month` to that archive month, clear `current_month_in_progress`, and bump `total_entries_updated` by the number applied. Also record the recent live coverage from prep separately as `recent_live_months_reviewed`, `recent_live_reviewed_at` (use staged `generatedAt`), and `recent_live_entries_reviewed` (from `summary.recentLiveEntriesReviewed`). Do **not** add current/prior live months to `months_completed`; that array is only the backwards archive cursor. Write the compact single-line JSON back via the CLI.

Return success or empty after Scanner-State is persisted. The DAG executor owns the review date.

## Summary

Output a brief summary folded into the daily review:

- Archive month applied
- Recent live months reviewed
- Total entries reviewed (from `summary.entriesReviewed`)
- Total entries updated / skipped
- Breakdown by change type (people tags added, hobbies tagged, typos fixed, emojis added)

## Idempotency

A re-run after a completed apply reads `status: "empty"` (prep found nothing new) and skips without re-applying. Never run the same `applyOps` twice.
