---
description: Walk everything dated that needs handling today — overdue recurring review items in Personal > 🔄 Review, then one-shot due tasks from the Workflowy ⏰ buckets, Things 3, and Apple Reminders. Use when the user wants to run their recurring review, clear overdue items, or do the recurring portion of the daily review.
---

# Recurring Review

Two segments, walked back to back as one continuous question sequence:

- **Segment 1 — recurring items.** Items in `Personal > 🔄 Review` that come back on an interval. Handling one advances its date by its section's cadence.
- **Segment 2 — due items.** One-shot tasks that should be done once and go away, merged from the Workflowy `⏰ Tasks (due dates)` buckets, Things 3, and Apple Reminders. Handling one completes, reschedules, or drops it.

Both segments follow `${CLAUDE_PLUGIN_ROOT}/skills/due-item-walk.md` — presentation, the banned scoping questions, freeform handling, read-before-write, and the background dispatch protocol all live there. Read it before starting. The segments stay separate because their write-backs differ: a recurring item normally returns, while a one-shot task should not.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

---

## Segment 1 — Recurring items

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

`overdue.json` is an ordered array (by section priority, then due date) where each row carries `section`, `shortId`, `id`, `name`, `due`, `overdueByDays`, `isLlmTask`, `hasKids`, `nextDate`, `newName`, `applyOp` (the verbatim `node update` to run on "done"), `skipStreak` / `skippedSince` folded from the skip log, and `lengthen` (the staged move to the next longer cadence). The script already skips `🗃️ Routine Archive`, skips future-dated items, compares dates as ISO strings (avoiding the `new Date()` UTC-vs-local footgun), and clamps month rollovers (Jan 31 + 1 month → Feb 28). Pass `--print` instead of redirecting for a human-readable dump while debugging.

The script assumes the canonical shape: section headers carry no date, intermediate groups carry no date, and the `<time>` lives on the **leaf item**. **If the data doesn't match — a `<time>` on an intermediate group, or a "leaf" whose children each carry their own date — stop and ask the user to fix the data in Workflowy** rather than reinterpreting it here.

A row with `needsInterval: true` (section `Every few years` or an unrecognized section) has `nextDate`/`applyOp` set to `null` — ask the user for the interval and build the date write per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`.

Walk `overdue.json` in array order — it is already sorted by section priority and then due date.

## Section Interval Mapping

The section → interval table lives in `compute-overdue.mjs` (the executable source of truth) and is mirrored for reference in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`, which also documents the `<time>` element format and the CLI update commands.

## Recurring item options

Done / skip / notes / retire, per the walk skill. On "done", run the row's staged `applyOp` **verbatim** — it is the complete `node update` that advances the `<time>`, already computed and shell-escaped.

Record every outcome to the skip log, keyed by the row's `id`, per the walk skill's record step.

On **retire**, the user has explicitly said the recurring item should no longer exist. Delete it by full UUID:

```bash
./bin/run.js node delete --id <uuid>
```

Dispatch the delete as the item's outcome write. Do **not** run `applyOp` or otherwise advance the date. Continue to the next item and count this one as retired in the finish summary.

## Less often: the cadence outcome for a repeatedly skipped item

A recurring item's cadence **is** its section, so making it less frequent means moving it down the ladder — `🔄 Daily Review` → `🗓️ Weekly Review` → `📅 Monthly Review` → `🗓️ Every 2 months` → `🗓️ Every 6 months` → `🎆 Annual Review`. `compute-overdue.mjs` stages that whole move on every row as `lengthen`:

```json
{
	"section": "🗓️ Weekly Review",
	"sectionId": "<uuid of that section>",
	"interval": {"amount": 7, "unit": "d"},
	"nextDate": "2026-07-03",
	"newName": "<the item name with its time element advanced to nextDate>",
	"applyOp": "<node update writing newName> && <node move into sectionId>"
}
```

When a row has `skipStreak >= 2` and a non-null `lengthen`, add an explicit outcome labelled with the target cadence — **Less often → 🗓️ Weekly Review** — and show the streak in the question body (`Skipped 3 runs in a row since 2026-08-11.`). Place it above Done/Skip and above Retire. Repeatedly skipping a daily item usually means it should not be daily, not that it should be deleted, so **Retire is never the promoted answer to a streak**.

On that outcome, dispatch `lengthen.applyOp` **verbatim** — it advances the `<time>` by the new interval and moves the node into the new section in one chained command — and record the outcome as `lengthen`. Count it in the finish summary as a cadence change, not as a date advance.

`lengthen` is `null` when the item is already at the top of the ladder, when its section has no recognized interval, or when the target section is missing from the fetched tree. In that case ask the user for the new cadence and build the move by hand per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`.

## LLM tasks (#llm-task)

Items tagged with `#llm-task` contain executable instructions in their child nodes. Before walking through a section's regular items, batch the section's overdue `#llm-task` items through the same flow as the `/gtd:review:daily` LLM Tasks phase: list them up front — name, child instructions, and whether each is mandatory — and then **start executing without a skip prompt**. The listing is the plan-visibility moment, not a gate; every task runs by default and the user interjects if they want one dropped. Mandatory tasks always run and are never droppable. No due `#llm-task` items → nothing to list and nothing to run.

Task **execution** stays foreground. If a task runs `cache import-api` / `just daily`, you MUST first drain all pending background date-writes — otherwise the import can clobber items whose API write has not yet landed. Only the post-task date advancement is backgrounded.

**Open-then-confirm tasks.** Some `#llm-task` items only instruct you to open a page/URL for a manual action the user completes themselves (e.g. Amazon Chase rewards redemption, Patreon benefits review). For these, **open the page first** (`open <url>`) and **then** ask whether the task is actually done — opening the page is not the task. In the `AskUserQuestion` body, state both halves explicitly: what you already did (including the page you opened and any script you ran), and the exact manual step the user must perform, read from the item's child instructions. A status-only message such as "The benefits page is open for review" is not enough. Opening can succeed while the real action cannot (a financial submit the user must perform, a page that won't load, info not yet available), so never infer "done" from a successful `open`. Advance the date only on a real "done".

---

## Segment 2 — Due items

One-shot dated tasks from three sources. Runs immediately after Segment 1, with no phase boundary and no "shall we continue" prompt between them.

## Why these three together

They are the same kind of thing — a task with a deadline that should be done once — stored in three systems that model dates differently. Walking them separately meant Workflowy's buckets were never walked at all, and items reached 90 days overdue while technically being on screen every morning.

## Fetch all three sources

Front-load them; they have no data dependencies.

**Workflowy** — resolve both Next-Actions roots from the metadata anchor, then dump each deep enough to reach the tasks:

```bash
mkdir -p .llm/gtd/review
./bin/run.js node get --id d81ba063-5604-49a5-bb87-0d0fe59d0a48 --depth 1 --json \
  --fields name,shortId,id,children,linkTargets > .llm/gtd/review/next-actions-meta.json
```

Read `linkTargets[0].id` for each child to get each root's full UUID, then for each root:

```bash
./bin/run.js node get --id <rootUuid> --depth 4 --json \
  --fields id,shortId,name,completedAt,priority,children > .llm/gtd/review/root-<work|personal>.json
```

Combine them into the collector's input shape — an array of `{rootKey, root}` — at `.llm/gtd/review/due-workflowy.json`.

**Things 3:**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-things-due.mjs > .llm/gtd/review/due-things.json
```

**Apple Reminders** — launch the `reminders-fetcher` agent and save its JSON to `.llm/gtd/review/due-reminders.json`. The iMCP halt rule applies: if the fetcher returns `status: "imcp-unavailable"`, **stop the review** regardless of `fatal` — do not walk a partial set.

## Compute the working set

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/collect-due-items.mjs \
  --workflowy .llm/gtd/review/due-workflowy.json \
  --things .llm/gtd/review/due-things.json \
  --reminders .llm/gtd/review/due-reminders.json \
  > .llm/gtd/review/due-items.json
```

Each row carries `source`, `id`, `title`, `due`, `dueSource`, `overdueByDays`, `needsDate`, `group`, `url`, `childCount`, `skipStreak` / `skippedSince` folded from the skip log, and an `ops` object holding the verbatim `complete`, `reschedule`, and `drop` commands. Rows are sorted by due date with undated items last. Anything not yet due is already excluded. Pass `--print` for a human-readable dump while debugging.

**Source semantics the collector already resolved, so the walk doesn't have to:**

- Only the `⏰` bucket is collected. The `📌 Tasks (asap)` bucket has no dates and is out of scope.
- A task's children are sub-steps, notes, and provenance — never tasks in their own right.
- A Things task in the Today list without a deadline is dated to **today**, with `dueSource: "scheduled"`. Things putting it in Today is the due signal.
- Reminders `dueTomorrow` is excluded; this walk is for what is due now, not a preview.
- A Workflowy task in the `⏰` bucket with no `<time>` gets `needsDate: true` — see below.

## Due item options

First option is the most likely outcome, per the walk skill:

- **Done** — run `ops.complete` verbatim.
- **Reschedule** — offer `Today`, `This week`, `This month`, and `Other`. Convert the choice to a date with `resolveTimeframe` from `collect-due-items.mjs` (never by hand — "this week" means the upcoming Friday and the weekday must be computed), then build the command with `applyReschedule(item, iso)` from the same module and run it. **Never substitute `{{date}}` yourself.** The three sources need different representations — Workflowy takes a `<time>` element, Things and Reminders take an AppleScript `date "August 31, 2026"` string — and dropping HTML into an `osascript` call sets a garbage date instead of failing. `applyReschedule` picks the right one from the row's `source`.
- **Not actually due → move to asap** — run `ops.moveToAsap` (Workflowy rows only). The task is real but has no deadline, so it belongs in `📌 Tasks (asap)` rather than the `⏰` bucket. The op strips the `<time>` element and moves the node in one chained command, landing it on the **bottom tier** of that bucket's priority ladder — a task that never had a deadline has not earned a rank, and the user promotes it later during File Loose Tasks if it deserves one. **Offer this on every Workflowy row that carries it** — without it the only way to clear an undeadlined task is to keep pushing its date, which is why tasks reach 40+ days overdue while being "handled" every run. Reschedule is for work that genuinely has a deadline you're moving; this is for work that never had one.
- **Drop** — run `ops.drop`. For Workflowy this deletes the node; for Things and Reminders it cancels or deletes the task. Confirm before dropping anything with `childCount > 0`.
- **Skip** — write nothing.

Record every outcome to the skip log, keyed `<source>:<id>` (`things:ABC123`, `workflowy:<uuid>`, `reminders:<title>`), per the walk skill's record step.

## Push it out: the cadence outcome for a repeatedly skipped task

Each row carries `skipStreak` and `skippedSince`. When `skipStreak >= 2`, show the streak in the question body and promote a **longer horizon** above the ordinary reschedule — a task nudged from "today" to "this week" three runs running is a task whose date is fiction. `resolveTimeframe` accepts `Next month` and `Next quarter` alongside the usual timeframes, so build the write exactly as a reschedule: resolve the label, then `applyReschedule(item, iso)`.

For a Workflowy row, `ops.moveToAsap` remains the better answer when the streak is really about a task that never had a deadline. Offer the longer horizon for work with a real but movable deadline, and `moveToAsap` for work with none.

**Drop stays available and stays unpromoted.** A streak means the date was wrong, not that the task is dead.

## Items missing a date

A row with `needsDate: true` is a Workflowy task filed into the `⏰` bucket without a `<time>`. The bucket means "this has a deadline", so a missing date is a data defect, not a valid state. Present these at the end of the segment and ask for a date using the same `Today` / `This week` / `This month` / `Other` options. Running `ops.reschedule` on an undated node appends the new element rather than swapping one.

Do not silently leave a task undated. An undated task in the due-dates bucket is invisible to every future run of this walk, which is exactly how the backlog formed.

## Finish

Drain all outstanding background writes per the walk skill, then print one summary line covering both segments — e.g. `✓ 12 recurring dates advanced, 3 cadences lengthened, 2 retired · 9 due items completed, 4 rescheduled, 2 pushed out, 2 dropped` — or list failures by item name instead of reporting success.
