---
description: Process overdue recurring review items in Personal > 🔄 Review one at a time, recording done/skip/notes and advancing each item's date on completion. Use when the user wants to run their recurring review, clear overdue review items, or do the recurring portion of the daily review.
---

# Recurring Review

Walk through overdue items in `Personal > 🔄 Review`, presenting each one for the user to handle, then update its date.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Fetch Review Tree

```bash
mkdir -p .llm/gtd/review
./bin/run.js node get --path "Personal,🔄 Review" --depth 3 --json \
  --fields id,shortId,name,priority,children > .llm/gtd/review/tree.json
```

**Re-fetch after any data import** (`just daily`, `cache import-api`, etc.) — re-run the fetch above to overwrite `tree.json` and recompute the overdue list. Stale data causes wrong "overdue by N days" math and already-resolved prompts.

## Identify Overdue Items

Run the date math in a script — never re-derive it by hand. `compute-overdue.mjs` parses each leaf item's `<time>`, finds the items due on or before today, orders them, and stages the exact `node update` that advances each one to today + its section's interval:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/compute-overdue.mjs .llm/gtd/review/tree.json > .llm/gtd/review/overdue.json
```

`overdue.json` is an ordered array (by section priority, then due date) where each row carries `section`, `shortId`, `id`, `name`, `due`, `overdueByDays`, `isLlmTask`, `hasKids`, `nextDate`, `newName`, and `applyOp` (the verbatim `node update` to run on "done"). The script already skips `🗃️ Routine Archive`, skips future-dated items, compares dates as ISO strings (avoiding the `new Date()` UTC-vs-local footgun), and clamps month rollovers (Jan 31 + 1 month → Feb 28). Pass `--print` instead of redirecting for a human-readable dump while debugging.

The script assumes the canonical shape: section headers carry no date, intermediate groups carry no date, and the `<time>` lives on the **leaf item**. **If the data doesn't match — a `<time>` on an intermediate group, or a "leaf" whose children each carry their own date — stop and ask the user to fix the data in Workflowy** rather than reinterpreting it here.

A row with `needsInterval: true` (section `Every few years` or an unrecognized section) has `nextDate`/`applyOp` set to `null` — ask the user for the interval and build the date write per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`.

### Processing order

Walk `overdue.json` in array order — it is already sorted by section priority and then due date.

## Section Interval Mapping

The section → interval table lives in `compute-overdue.mjs` (the executable source of truth) and is mirrored for reference in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`, which also documents the `<time>` element format and the CLI update commands.

## Present Items

**Never ask how to scope, triage, or batch the walk — the volume is never grounds to ask.** `compute-overdue.mjs` has already produced the ordered working set, so there is nothing left to scope: go straight to item 1. No matter how many items are overdue — 40+ across many sections is normal and expected — do NOT open with a meta-question offering to bulk-advance dailies, do "only stale (Weekly+)", run "just the #llm-tasks", or "skip recurring today". The user **always** walks every overdue item one-by-one and has explicitly asked to stop being asked this.

This includes "summarize the count, then ask how to proceed." Do not print a breakdown of how many items are in each section and then check in — that is the same forbidden question wearing a summary. These openers are all banned, regardless of how they are phrased:

- "Walking N one-by-one is a lot / a long haul…"
- "Let me check how you want to handle the volume / the recurring review…"
- "…rather than firing N prompts at you."
- any "that's a lot" / "this is tedious" editorializing about the count.

The only correct first move after computing `overdue.json` is to present item 1.

**Present items one at a time via AskUserQuestion — never batch.** The user clears them quickly by tapping the first option.

For each overdue item, show its section context and overdue info, reading the fields straight from `overdue.json` (`section`, `due`, `overdueByDays`, `shortId`):

```markdown
**⬆️ Frequently Important** — 8 overdue items

Item 1/8: Record status in workflowy Status (due: 2026-02-09, overdue by 12 days) https://workflowy.com/#/aabb1122

Done, skip, or notes?
```

### LLM tasks (#llm-task)

Items tagged with `#llm-task` contain executable instructions in their child nodes. Before walking through a section's regular items, batch the section's overdue `#llm-task` items through the same flow as the `/gtd:review:daily` LLM Tasks phase: list them up front, then gate the run with a **single yes/no `AskUserQuestion`** whose options are `No — run everything (Recommended)` first, then `Yes — let me pick what to skip` (`multiSelect: false`). Default expectation is `No` — on `No` (or "Other" with equivalent intent), run every task without further prompting. Only on `Yes` issue a follow-up `multiSelect: true` AskUserQuestion with one option per skippable task to choose which to skip. Mandatory tasks always run and never appear as skip options. Skip-the-prompt edge cases are identical to Phase 0: no due `#llm-task` items → no prompt; no skippable tasks (only mandatory) → run everything without the yes/no prompt. Then continue with regular items per **Common behavior**.

Task **execution** stays foreground. If a task runs `cache import-api` / `just daily`, you MUST first drain all pending background date-writes (per **CRITICAL — drain before any cache reimport** in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`) — otherwise the import can clobber items whose API write has not yet landed. Only the post-task date advancement is backgrounded.

**Open-then-confirm tasks.** Some `#llm-task` items only instruct you to open a page/URL for a manual action the user completes themselves (e.g. Amazon Chase rewards redemption, Patreon benefits review). For these, **open the page first** (`open <url>`) and **then** ask whether the task is actually done — opening the page is not the task. Opening can succeed while the real action cannot (a financial submit the user must perform, a page that won't load, info not yet available), so never infer "done" from a successful `open`. Advance the date only on a real "done"; on "skip" leave it unchanged so it resurfaces.

### Common behavior

- Show the item name with embedded URLs rendered as clickable markdown links. Parse `<a href="...">text</a>` in the node name and render as `[text](url)` so the user can click them in the terminal.
- Show the Workflowy URL for the item itself
- Wait for user response: done, skip, or freeform text. A freeform answer is **not** automatically completion — classify it first (see **Freeform: note versus continued work**).
- Before writing anything into an item, **read its full subtree** (see **Read the subtree before writing**). Showing children is not the same as reading them.
- If the item has children, show them indented below
- After recording "Done" and **dispatching the date write in the background**, present the next item immediately — the write never blocks the next `AskUserQuestion`. See **Update Item Date on Done** below.
- After all items in a section are handled, move to the next section

### Freeform: note versus continued work

A freeform answer is either a **note** or **continued work**, and they end very differently:

- **Note** — a remark to record and move past ("went well", "waiting on the vendor"). File it as a child node via `node create`, **dispatched in the background** (a separate job from the date write, per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`), treat the item as done, and continue.
- **Continued work** — an instruction, a correction, new information, or a request to keep going on this item ("I plugged in another drive, go inventory it", "that is wrong, redo it"). Stay on the item and do the work. Do **not** advance the date and do **not** present the next item.

When continued work is in progress, only an explicit "done" or "skip" from the user ends the item. Silence, a completed sub-task, or your own sense that the work looks finished never earns the date write. When the answer is genuinely ambiguous, treat it as continued work — resuming a finished item is cheap; advancing a date on unfinished work hides it for a whole interval.

### Read the subtree before writing

Before writing into a review item, fetch and read its full subtree:

```bash
./bin/run.js node get --id <full-uuid> --depth 4 --json
```

Then conform to what is already there:

- **Match the existing format.** If sibling entries share a shape, the new entry uses that shape rather than one you invent.
- **Match the existing placement.** A new entry belongs alongside its siblings — not appended at the end of the item, and not nested under an unrelated child.
- **Keep instruction children separate from data children.** Nodes that tell you what to do are not entries; never interleave new data into them.
- **Execute conditional instructions whose trigger currently holds.** When the subtree says "if X is present, do Y" and X is present right now, do Y as part of handling the item instead of deferring it.

Showing an item's children to the user is not reading them. Skipping this step produces writes that look plausible and are structurally wrong.

## Update Item Date on Done

On "done", run the item's staged `applyOp` from `overdue.json` **verbatim** — it is the complete `node update` that advances the `<time>` to today + the section's interval, with the new element already computed and shell-escaped. Dispatch it as a background job and follow **Background Dispatch, Verify, and Drain** in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md` for the full protocol (dispatch, ~5-item reap cadence, and drain-before-finish). Do not rebuild the `<time>` element by hand. For a `needsInterval` row, ask the user for the interval and build the write per that skill instead.

## Finish the Review

Drain all outstanding background writes per that skill, then print a one-line summary (`✓ 12 dates advanced`), or list any failed items by name instead of reporting success. Also drain before any step that runs `cache import-api` / `just daily`.
