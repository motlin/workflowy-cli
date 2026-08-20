---
description: Daily review orchestrator — run the full morning routine in order: execute due automated LLM tasks, relink orphaned items, review meeting follow-ups, give the morning overview, process the inbox, file loose tasks, and walk every dated item that needs handling today. Use whenever the user asks to do, start, or run their daily review or morning GTD routine.
---

# Daily Review

Run the full daily review: execute overdue LLM tasks, tidy misfiled items off the navigation links, get oriented with the morning overview, empty the inbox, file loose tasks, and finish by walking everything dated that needs handling today.

The phases run in dependency order — each one's output feeds the next, ending with the walk that asks what's actually done:

```text
LLM Tasks → Relink → Meetings → Overview → Process Inbox → File Loose Tasks → Recurring Review
                                    (producers of dated tasks) ──────────────↗
```

The Meeting Follow-up Review, Morning Overview, and Recurring Review phases delegate to `/gtd:review:daily:meetings`, `:overview`, and `:due`, each of which already carries the "do not use the built-in task list" rule — don't create built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) for the LLM Tasks phase either.

## When a skill breaks, fix the skill first

If you discover a bug in a skill, command, or script **while running the review** — a script that errors, a command that does the wrong thing, a wrong assumption baked into these docs — stop the review and fix the skill first, then resume. Do not work around it inline and press on. Fixing the skill is red/green TDD (write the failing test, fix, run `vp check` / `vp test` per the project precommit checklist), and it takes priority over finishing the day's review, because every future run benefits. This is distinct from a data/MCP failure (see [Handling failures](#handling-failures)); that path is about pausing and asking, this one is about the tooling itself being wrong.

## Never offer to pause or wrap up

The review runs every phase to completion. Only a verified failure halts it, and only the user may choose to stop. Never raise the length of the run as a question, in any phrasing:

- "This session has run very long — continue or wrap up?"
- "There are N items left. Continue or pause?"
- "Do you want me to continue the last phases now, or finish this tomorrow?"
- "We're deep into the context budget — should I stop here?"
- any variant that offers to defer, postpone, or skip remaining phases, or that asks about elapsed time, item volume, session length, or context/usage budget.

These questions read as trying to skip steps. The user has already asked for the whole review by invoking it; volume is not new information they need to rule on. Keep working and let them interrupt if they want to stop. This applies to every phase, not just the recurring walk — `daily/due.md` bans the same openers inside its item loop.

## Never work around a failure — HALT

**This is the highest-priority rule in the review. Read it as absolute.**

When _any_ step fails — a command errors, a script exits non-zero, an MCP is down, a network call hangs, or the data cannot be positively verified as fresh — **STOP the review immediately and surface the failure to the user.** Do **not**:

- work around it by running sub-steps yourself (e.g. the recipe failed, so you run `import-api` by hand),
- proceed on a stale, partial, or degraded cache/dataset,
- treat "the process exited" or "exit code 0" as success. A piped `… | tail` reports **tail's** exit code, not the command's; and a process can exit 0 having synced nothing. **Verify the actual result**, never a proxy for it.

"Continuing" is a decision that must be **earned by positive verification**, never assumed. If you cannot verify success, you have not succeeded — halt. Silently recovering or pressing on with degraded data corrupts every downstream step (a stale cache makes refinement skip the newest entries, dedup re-propose handled items, and dates advance on work that never happened). A halted review the user can re-run beats a completed review built on sand.

### The import barrier must be verified

The `Import` barrier exists so the whole fan-out reads today's data. Before any prep fan-out:

- Run the import **without masking its exit code** (do not pipe the barrier command through `tail`/`head`; capture output to a file and read it, or check `${PIPESTATUS[0]}`).
- **Positively verify the live API sync landed:** `cache import-api` printed its `Fetched N nodes … / +A added, ~U updated, =… unchanged, -D deleted` summary, the node count is sane, and today's data is actually present (e.g. today's calendar date node exists). Exit code alone is insufficient.
- If the import errored, hung, or cannot be verified, **HALT** — do not fan out on a stale cache. Fix the cause (or ask the user to) and re-run the barrier from the top.

## Automated Tasks

Run the mandatory import barrier, then execute due tasks from `Personal > 🔄 Review > 🔄 Daily Review > LLM Tasks:`. The tree is a dependency DAG: prep work fans out, serial groups preserve write ordering, and presentation follows a fixed order.

### Fetch and validate the plan

```bash
mkdir -p .llm/gtd/review
./bin/run.js node get --path "Personal,🔄 Review,🔄 Daily Review,LLM Tasks:" --depth 6 --json --fields name,shortId,id,children,completedAt > .llm/gtd/review/phase0-llm-tasks.json
node ${CLAUDE_PLUGIN_ROOT}/scripts/compute-llm-dag.mjs .llm/gtd/review/phase0-llm-tasks.json > .llm/gtd/review/phase0-plan.json
```

The planner validates this plain structure before anything fans out:

```text
LLM Tasks:
  Import
  Prep
    Scan email for events <time...>
      /gtd:email-calendar-prep
      Interval: 7d
    Birthdays <time...>
      /gtd:birthdays-auto
      Auto
    Serial: group name
      Refine calendar journal <time...>
        /gtd:refine-journal-prep
  Presentation
    Scan email for events
      /gtd:email-calendar-apply
    Refine calendar journal
      /gtd:refine-journal-apply
```

Prep and presentation pair by their identical date-stripped task names. The planner infers the artifact slug from the prep command by removing a trailing `-prep` or `-auto`; `/gtd:email-calendar-prep` therefore stages `email-calendar`. `Interval` is optional and defaults to `1d`; supported units are `d`, `m`, and `y`. `Auto` is only for prep tasks that have no presentation entry. Presentation inherits its due state, slug, and interval from prep, so it carries no date. Placement already identifies prep versus presentation; `Key:`, `#llm-task`, `· prep`, `· apply`, marker emoji, and duplicate dates are invalid clutter.

The planner rejects unexpected root children, obsolete `Key:` markers, duplicate or unmatched task names, duplicate inferred slugs, invalid intervals, missing prep dates, dates on presentation tasks, and presentation entries for auto tasks. Any validation error halts the review.

Tasks elsewhere in `Personal > 🔄 Review` remain recurring-review tasks and use their section's cadence. They are not part of this DAG.

### Present the due plan

List every due prep task and its inherited presentation entry from `phase0-plan.json` before execution. Show the human name, instructions, Workflowy link, whether it is auto, and whether its branch is parallel or serial. Show the import barrier as done.

Ask about skipping in exactly **one** `AskUserQuestion` question, never two or more, no matter how many tasks are due. The user must be able to decline every skip with a single answer, so make the first option a "run everything" choice. When more due tasks exist than the four option slots allow, do not split the question across multiple questions — list the skippable tasks in the question text and let the user name any exceptions through "Other". Skipping prep also skips its name-matched presentation. Auto tasks and the import barrier are mandatory. If no tasks are due, continue without prompting; if only mandatory tasks are due, run them without the skip question.

### Execute the plan

Follow `${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md` and `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`:

- Run metadata sync once.
- Dispatch each `parallel` prep branch independently and each `serial` branch through one ordered controller, capped at five concurrent prep units.
- Start the presentation walk as soon as the branches are in flight. Block only for the current task's staged result.
- Treat `status: "empty"` as successful work with no prompt.
- After a paired apply succeeds, run that task's `advance.applyOp` from `phase0-plan.json` verbatim in the background.
- After an auto task succeeds, run its `advance.applyOp` the same way.
- On skip, failure, or unverified work, leave the date unchanged.

The executor owns date advancement. Prep, apply, and auto commands never update their own schedule. This keeps one date on the prep node and makes arbitrary intervals deterministic.

Interpret non-marker children as commands or instructions. `/gtd:...` invokes a plugin command; shell commands run in Bash; nested children add detail. `Interval` and `Auto` are markers, not instructions.

Do not create Claude Code built-in tasks (`TaskCreate`, `TaskUpdate`, or `TodoWrite`).

### Handling failures

Never silently skip a task. If a command, MCP, network call, validation, or verification fails, stop and surface the failure. Retry once or twice when reasonable, then ask the user whether to fix it or explicitly skip it. A skipped or failed task keeps its date.

Drain every background date write before a cache import, before leaving this phase, and before relinking. Follow `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md` for dispatch and verification.

### Summarize

Drain the writes and report applied, skipped, failed, and advanced counts. Fold auto briefing lines from `.llm/gtd/review/briefings/` into the same summary.

## Relink Orphaned Children

Invoke `/gtd:review:daily:relink` — move any children that have accumulated on the GTD bucket navigation links under `Metadata` onto the real nodes their links point to. Mechanical and automatic (no prompts); runs here so it operates on the freshly-imported cache. Report its summary.

## Meeting Follow-up Review

Invoke `/gtd:review:daily:meetings` to walk meetings ingested since last review, flag probable follow-ups (especially from direct manager), and drop confirmed items into Inbox.

## Morning Overview

Invoke `/gtd:review:daily:overview` — morning orientation (calendar, reminders, next actions, inbox)

## Process Inbox

Invoke `/gtd:refine-inbox`, then `/gtd:inbox` — refine each inbox item with a 🔍 Refinement suggestion, then walk the confirm-and-move loop that files them to their GTD destinations. Runs here because the Meeting Follow-up phase just dropped confirmed follow-ups into Inbox and nothing else in the review would ever pick them up. Filing them now means anything that lands with a date reaches the due walk in this same run. Silent-skip when all inboxes are empty.

## File Loose Tasks

Invoke `/gtd:review:daily:file-tasks` — normalize the Next-Actions trees, then sweep loose tasks under both roots (Work and Personal) into the `⏰ Tasks (due dates)` bucket or a priority tier of the `📌 Tasks (asap)` ladder, and sweep undated Things "Anytime" tasks into the personal ladder. Proposes a destination per task and walks them one at a time for confirmation. Relink already ran, so strays are on the real roots; silent-skip when no loose tasks and no Anytime backlog remain.

## Recurring Review

Invoke `/gtd:review:daily:due` — two segments walked back to back: overdue recurring review items in `Personal > 🔄 Review`, then one-shot due tasks merged from the Workflowy `⏰` buckets, Things 3, and Apple Reminders.

**This phase runs last, and the order matters.** File Loose Tasks and Process Inbox are both _producers_ of dated tasks — filing something as due today must be followed by the walk that asks whether it's done, not preceded by it. Running the walk earlier would hide everything the earlier phases just created for a full day.

**Note:** LLM tasks already processed in the LLM Tasks phase will have updated dates and won't appear as overdue here.
