---
description: Reference for validating and executing the daily review's keyed prep and presentation DAG, including inherited scheduling, parallel and serial prep, auto tasks, and shared-state safeguards.
globs: ${CLAUDE_PLUGIN_ROOT}/commands/review/**
---

# DAG LLM Tasks

The daily review executes `Personal > 🔄 Review > 🔄 Daily Review > LLM Tasks:` as a dependency DAG. Tree placement defines execution phase; keys link prep work to presentation; optional markers add only the information that placement cannot express.

## Canonical tree

```text
LLM Tasks:
  Import
    op run -- just daily
    ./bin/run.js cache sync-node --id <full-uuid> --recursive
  Prep
    Serial: Calendar journal
      Otter journal <time...>
        /gtd:otter-journal-auto
        Key: otter-journal
        Auto
      Refine calendar journal <time...>
        /gtd:refine-journal-prep
        Key: refine-journal
    Refine inbox <time...>
      /gtd:refine-inbox
      Key: process-inbox
    Time Machine exclusions <time...>
      /gtd:time-machine-exclusions-prep
      Key: time-machine-exclusions
  Presentation
    Refine calendar journal
      /gtd:refine-journal-apply
      Key: refine-journal
    Process inbox
      /gtd:inbox
      Key: process-inbox
    Time Machine exclusions
      /gtd:time-machine-exclusions-apply
      Key: time-machine-exclusions
```

The schema is strict:

- Root children are exactly `Import`, `Prep`, and `Presentation`.
- Every prep task has one `Key: <slug>` and one `<time>` element.
- A paired presentation task has the same key and no date.
- `Interval: <amount><unit>` is optional on prep and defaults to `1d`; units are `d`, `m`, and `y`.
- `Auto` marks prep that completes without presentation. Auto keys must not appear under `Presentation`.
- `Serial: <name>` groups prep tasks that must run top-to-bottom. Other direct children of `Prep` are independent parallel branches.
- Task names are human labels. Do not add `#llm-task`, `prep`, `apply`, or marker emoji to names; placement and markers already carry that information.

Run `${CLAUDE_PLUGIN_ROOT}/scripts/compute-llm-dag.mjs` before execution. Its output is the authoritative `.llm/gtd/review/phase0-plan.json`; validation failure halts the review.

## Scheduling

Only prep nodes own schedules. The planner compares each prep date to today, includes the linked presentation entry when prep is due, and precomputes the next date from today plus the task interval.

After verified success, the main executor runs the task's `advance.applyOp` from the plan verbatim. Task commands never advance their own date. Empty prep is successful; skipped, failed, and unverified work leaves the date unchanged.

This central ownership prevents prep and presentation dates from drifting and supports daily, weekly, monthly, and yearly prep/apply tasks with the same mechanism.

## Import barrier

Run every instruction under `Import` inline. Do not pipe the commands through `head` or `tail`. Confirm the API import reports its fetched and changed node counts and verify current data is present. Drain pending background writes before the import and before prep fan-out.

If freshness cannot be positively verified, halt.

## Prep fan-out

Run metadata sync once before fan-out. Prep workers read the resulting `.llm/gtd/metadata/` cache and never rebuild it concurrently.

Dispatch one background controller per due branch from the plan:

- A `parallel` branch contains one independent task.
- A `serial` branch runs its due tasks in tree order, waiting for each before starting the next.
- Keep at most five prep controllers in flight.

Each prep worker is autonomous, never prompts, and stages `.llm/gtd/review/proposals/<key>.json`. Auto workers complete their autonomous work and stage `.llm/gtd/review/briefings/<key>.json`.

## Presentation walk

Begin presentation as soon as prep controllers are running. Walk the plan's presentation array in order and wait only for the current key's staged result. Later slow work must not delay an earlier ready key.

Apply commands read their staged result and return one of:

- success: work is verified; the executor dispatches the key's date operation.
- empty: nothing needed attention; the executor dispatches the date operation without prompting.
- skipped: the user deferred the work; the date stays unchanged.
- failure: work or verification failed; halt and leave the date unchanged.

Continue reaping prep controllers and background date writes throughout the walk.

## Shared-state safeguards

- Run metadata sync once; prep workers only read it.
- Drain every pending write before an import or cache rewrite.
- Serialize tasks that write the same Workflowy subtree.
- Keep parallel branches on distinct write targets.
- Use the plan's presentation order, never completion race order.
- Report a pending key and elapsed time when its prep delays presentation.
- Fetch only required fields and redirect deep trees to `.llm/` rather than placing them in agent context.

## Completion

Drain prep controllers and every date write before relinking. Surface failures by key. Summarize applied, empty, skipped, failed, and advanced tasks, then append auto briefing lines.
