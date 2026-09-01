---
description: Walk everything dated that needs handling today — overdue recurring review items in Personal > 🔄 Review, then one-shot due tasks from the Workflowy ⏰ buckets, Things 3, and Apple Reminders. Use when the user wants to run their recurring review, clear overdue items, or do the recurring portion of the daily review.
---

# Recurring Review

Two segments, walked back to back as one continuous question sequence:

- **Segment 1 — recurring items.** Items in `Personal > 🔄 Review` that come back on an interval. Handling one advances its date by its section's cadence.
- **Segment 2 — due items.** One-shot tasks that should be done once and go away, merged from the Workflowy `⏰ Tasks (due dates)` buckets, Things 3, and Apple Reminders. Handling one completes, reschedules, moves it to Workflowy, or drops it.

Both segments follow `${CLAUDE_PLUGIN_ROOT}/skills/due-item-walk.md` — presentation, showing each item's real context immediately before its question, the banned scoping questions, freeform handling, read-before-write, and the background dispatch protocol all live there. Read it before starting. The segments stay separate because their write-backs differ: a recurring item normally returns, while a one-shot task should not.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

---

## Segment 1 — Recurring items

## Fetch Review Tree

```bash
mkdir -p .llm/gtd/review
./bin/run.js node get --path "Personal,🔄 Review" --depth 4 --json \
  --fields id,shortId,name,note,modifiedAt,priority,completedAt,mirror,children > .llm/gtd/review/tree.json
```

**Re-fetch after any data import** (`just daily`, `cache import-api`, etc.) — re-run the fetch above to overwrite `tree.json` and recompute the overdue list. Stale data causes wrong "overdue by N days" math and already-resolved prompts.

## Identify Overdue Items

Run the date math in a script — never re-derive it by hand. `compute-overdue.mjs` parses each leaf item's `<time>`, finds the items due on or before today, orders them, and stages the exact `node update` that advances each one to today + its section's interval:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/compute-overdue.mjs .llm/gtd/review/tree.json > .llm/gtd/review/overdue.json
```

The fetch must include `completedAt`: a finished recurring item keeps its stale `<time>`, and without that field the walk asks the user about work they already did (10 of 51 rows in one run). `compute-overdue.mjs` drops completed items, but only if the field reaches it.

`overdue.json` is an ordered array (by section priority, then due date) where each row carries `section`, `shortId`, `id`, `name`, `due`, `overdueByDays`, `isLlmTask`, `nextDate`, `newName`, `applyOp` (the verbatim `node update` to run on "done"), `skipStreak` / `skippedSince` folded from the skip log, and `lengthen` (the staged move to the next longer cadence). It also carries the context each question needs — `url`, `note`, `modifiedAt`, `childCount`, `children` (title, note, own child count, url), and `links` (every http(s) URL in the item's name and note) — which is why the fetch above asks for `note,modifiedAt` at depth 4. Show it per **Show the item, do not just name it** in the walk skill. The script already skips `🗃️ Routine Archive`, completed items, **mirror nodes and their whole subtree**, and future-dated items; compares dates as ISO strings (avoiding the `new Date()` UTC-vs-local footgun); and clamps month rollovers (Jan 31 + 1 month → Feb 28). Pass `--print` instead of redirecting for a human-readable dump while debugging.

The fetch must ask for `mirror`, and the reason is not cosmetic. `Set goals for today` carries **mirrors of the four task buckets** as its children, so a walk that cannot see `mirror.isMirror` descends straight through them and reports one-shot `⏰ Tasks (due dates)` tasks as overdue **recurring** items. Those tasks are correctly filed; they are merely reflected. Acting on that misreading means stripping real due dates off real tasks — it happened on 2026-08-31 to six of them. `compute-overdue.mjs` skips any node whose `mirror.isMirror` is true along with everything beneath it, but only when the field reaches it.

Never file a task by moving it onto a mirror either: `node move --parent-id <mirror-uuid>` parents the node **under the mirror**, not under the node the mirror reflects, which drops a real one-shot task inside the recurring tree. Resolve destination buckets from the Next-Actions roots (`linkTargets[0].id`) and confirm `mirror.isMirror` is false before writing.

The script assumes the canonical shape: section headers carry no date, intermediate groups carry no date, and the `<time>` lives on the **leaf item**. **If the data doesn't match — a `<time>` on an intermediate group, or a "leaf" whose children each carry their own date — stop and ask the user to fix the data in Workflowy** rather than reinterpreting it here.

A row with `needsInterval: true` (section `Every few years` or an unrecognized section) has `nextDate`/`applyOp` set to `null` — ask the user for the interval and build the date write per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`.

Walk `overdue.json` in array order — it is already sorted by section priority and then due date.

## Section Interval Mapping

The section → interval table lives in `compute-overdue.mjs` (the executable source of truth) and is mirrored for reference in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`, which also documents the `<time>` element format and the CLI update commands.

## Recurring item options

Done / Set a reminder / skip / notes / retire, per the walk skill. Before each question, `open` any external `links` the row carries (never the workflowy.com permalink — see the walk skill) and print its `note`, `modifiedAt`, and `children` — a recurring item like "Check wageworks balance" is answerable only from the running log in its subtree, and that log is what the last several entries look like. On "done", run the row's staged `applyOp` **verbatim** — it is the complete `node update` that advances the `<time>`, already computed and shell-escaped.

Offer **Set a reminder** on every row — an item the user will do later today but would forget without an alarm is a reminder, not a skip. Follow the shared walk's **Set a reminder** protocol and record `remind`.

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
./bin/run.js node get --id <rootUuid> --depth 5 --json \
  --fields id,shortId,name,note,modifiedAt,completedAt,priority,children > .llm/gtd/review/root-<work|personal>.json
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

Each row carries `source`, `id`, `title`, `due`, `dueSource`, `overdueByDays`, `needsDate`, `group`, `url`, `skipStreak` / `skippedSince` folded from the skip log, and an `ops` object holding the verbatim `complete`, `reschedule`, and `drop` commands. It also carries the context each question needs — `note` (the Workflowy note, the Things note, the Reminders note), `modifiedAt`, `childCount`, `children` (title, note, own child count, url), and `links` (every http(s) URL in the title and note) — which is why the Workflowy fetch above asks for `note,modifiedAt` at depth 5. Show it per **Show the item, do not just name it** in the walk skill: `open` the row's external `links` (not its workflowy.com `url`), print the children, and print all of it immediately before the `AskUserQuestion`. Rows are sorted by due date with undated items last. Anything not yet due is already excluded. Pass `--print` for a human-readable dump while debugging.

**Source semantics the collector already resolved, so the walk doesn't have to:**

- Only the `⏰` bucket is collected. The `📌 Tasks (asap)` bucket has no dates and is out of scope.
- A task's children are sub-steps, notes, and provenance — never tasks in their own right.
- A Things task in the Today list without a deadline is dated to **today**, with `dueSource: "scheduled"`. Things putting it in Today is the due signal.
- Reminders `dueTomorrow` is excluded; this walk is for what is due now, not a preview.
- A Workflowy task in the `⏰` bucket with no `<time>` gets `needsDate: true` — see below.

## Due item options

First option is the most likely outcome, per the walk skill. That is **Done** on Workflowy and Things rows and **Move to Workflowy** on Reminders rows — a dated reminder has nothing the `⏰` bucket does not do better, so moving it is almost always the answer.

- **Done** — run `ops.complete` verbatim.
- **Move to Workflowy** — offer on every **Things** and **Reminders** row; a Workflowy row is already home. The task is real and its date is real, but it lives in the wrong database. Follow the shared walk's **Move to Workflowy** protocol and record `moveToWorkflowy`. This keeps the date; **Clear the date** below is the separate outcome for a deadline that was fiction. The source mechanics are mandatory:
    - **Both sources** — create the task under the matching root's `⏰ Tasks (due dates)` bucket, with the row's `due` appended to the title as a `<time>` element built by `buildTimeElement` from `${CLAUDE_PLUGIN_ROOT}/scripts/collect-due-items.mjs` — the same stamp the file-tasks sweeps apply, never a hand-built one. Resolve the bucket UUID from the staged `root-<work|personal>.json` (the `⏰` child under the `✅ Tasks` wrapper), not from memory. Things and Reminders rows carry `rootKey: null`, so default to **Personal** and offer **Work** only when the title reads as work. Carry the row's `note` across as a child node when it holds a link or context the title alone loses. Append a topic `#tag` the same way the file-tasks sweeps do, and nothing more.
    - **Things 3** — a create-and-complete pair in one background job, chained with `&&` so a failed create can never destroy the task: `./bin/run.js node create --parent-id <dueBucketUuid> --name '<title><time element>' --position bottom && <ops.complete verbatim>`. Verify the node landed in the bucket and `return status of to do id "<id>"` reads `completed` — never trust the exit code.
    - **Apple Reminders** — run the Workflowy create now and, once it has returned, queue the reminder deletion (`ops.drop`) into the batched Reminders write below. Verify the new node and verify through `reminders_fetch` that the reminder is gone before counting it moved.
- **Reschedule** — offer `Today`, `This week`, `This month`, and `Other`. Convert the choice to a date with `resolveTimeframe` from `collect-due-items.mjs` (never by hand — "this week" means the upcoming Friday and the weekday must be computed), then build the command with `applyReschedule(item, iso)` from the same module and run it. **Never substitute `{{date}}` yourself.** The three sources need different representations — Workflowy takes a `<time>` element, Things and Reminders take an AppleScript `date "August 31, 2026"` string — and dropping HTML into an `osascript` call sets a garbage date instead of failing. `applyReschedule` picks the right one from the row's `source`.
- **Clear the date** — offer this on **every** row. The task is real but the deadline is fiction, so this is different from rescheduling it again, and different from **Move to Workflowy**, which keeps the date and only changes the store. Follow the shared walk's **Clear a fictional deadline** protocol and record `clearDate`. The source mechanics are mandatory:
    - **Workflowy** — load the matching root's asap ladder from the staged Workflowy data and ask which tier should receive the task. Use `planInsertion` from `${CLAUDE_PLUGIN_ROOT}/scripts/asap-tiers.mjs`, show and apply its demotion cascade, then run `ops.moveToAsap` verbatim. That op removes the `<time>` and lands on the bottom tier; if the user chose a higher tier, move the task from the bottom tier to `planInsertion.targetId` after the demotions.
    - **Things 3** — clear the due date in place with `delete due date of to do id "<id>"`. Leave the task in Things and do not ask for a Workflowy tier. Do **not** use `set due date … to missing value`: Things raises the same `Can't make missing value into type date (-1700)` error Reminders does, and the assignment silently accomplishes nothing. `delete due date` is the form that works. Verify with `return due date of to do id "<id>"`, which reads back `missing value` once it is cleared — never trust the exit code.
    - **Apple Reminders** — `set due date of r to missing value` fails with `Can't make missing value into type date (-1700)`. Ask for a Workflowy asap tier, create the task there, then queue the reminder deletion in the batched Reminders write. Verify the new Workflowy node and verify through `reminders_fetch` that the reminder is gone before considering it handled.
- **Set a reminder** — offer this on **every** row. The task is real and needs doing today, but the user will forget it without an alarm. Follow the shared walk's **Set a reminder** protocol and record `remind`. One source mechanic is mandatory: on an **Apple Reminders** row the alarm already exists, so never create a second one through Fantastical — set the requested time on the existing reminder by queuing it into the batched Reminders write below.
- **Drop** — run `ops.drop`. For Workflowy this deletes the node; for Things and Reminders it cancels or deletes the task. Confirm before dropping anything with `childCount > 0`.
- **Skip** — write nothing.

Record every outcome to the skip log, keyed `<source>:<id>` (`things:ABC123`, `workflowy:<uuid>`, `reminders:<title>`), per the walk skill's record step.

### Apple Reminders writes freeze — batch them, never write one per item

Reminders accepts a small number of AppleScript writes and then stops responding: `osascript` hangs until the timeout kills it, exits non-zero (124), and applies nothing. Reads through `reminders_fetch` keep working the whole time, which is what makes it confusing — the data is reachable, only writes are frozen. Quitting and relaunching Reminders.app clears it, but only for the next few writes.

So do **not** write a reminder per walk item. Instead:

1. Walk every reminder row and collect the user's decisions in memory. Workflowy and Things writes still happen immediately; only Reminders is deferred. A **Move to Workflowy** answer therefore splits: its Workflowy create runs now, and its reminder deletion joins this batch.
2. After the last item, quit and relaunch Reminders.app (`osascript -e 'tell application "Reminders" to quit'`, `pkill -9 -x Reminders` if it survives, `open -a Reminders`, sleep ~10).
3. Apply every reminder change in **one** `osascript` file with a generous `timeout` (180s), using handlers that look each reminder up by name and return a per-item status line.
4. **Verify with `reminders_fetch`, never with the script's exit code.** A batch that times out part-way still applies everything it reached, so diff the incomplete list against the decisions and retry only the stragglers individually.

Two behaviors that look like failures and are not:

- A **recurring** reminder does not disappear when completed — it rolls forward to its next occurrence. `Take the NAD plus` completing out of Aug 17 and reappearing dated Aug 23 is success, not a no-op.
- `trash` and Finder's AppleScript `delete` both exit 0 while silently failing on filenames containing emoji or fullwidth punctuation. `mv` to `~/.Trash` is the reliable path when clearing files.

Never report a reminder handled on the strength of an exit code. Every one of these paths has returned 0 while doing nothing.

## Push it out: the cadence outcome for a repeatedly skipped task

Each row carries `skipStreak` and `skippedSince`. When `skipStreak >= 2`, show the streak in the question body and promote a **longer horizon** above the ordinary reschedule — a task nudged from "today" to "this week" three runs running is a task whose date is fiction. `resolveTimeframe` accepts `Next month` and `Next quarter` alongside the usual timeframes, so build the write exactly as a reschedule: resolve the label, then `applyReschedule(item, iso)`.

For a row whose deadline was never real, **Clear the date** remains the better answer. Offer the longer horizon for work with a real but movable deadline, and clear the date for work with none.

**Drop stays available and stays unpromoted.** A streak means the date was wrong, not that the task is dead.

## Items missing a date

A row with `needsDate: true` is a Workflowy task filed into the `⏰` bucket without a `<time>`. The bucket means "this has a deadline", so a missing date is a data defect, not a valid state. Present these at the end of the segment and ask for a date using the same `Today` / `This week` / `This month` / `Other` options. Running `ops.reschedule` on an undated node appends the new element rather than swapping one.

Do not silently leave a task undated. An undated task in the due-dates bucket is invisible to every future run of this walk, which is exactly how the backlog formed.

## Finish

Drain all outstanding background writes per the walk skill, then print one summary line covering both segments — e.g. `✓ 12 recurring dates advanced, 3 cadences lengthened, 2 retired, 1 reminder set · 9 due items completed, 4 rescheduled, 2 pushed out, 3 moved to Workflowy, 1 date cleared, 2 reminders set, 2 dropped` — or list failures by item name instead of reporting success.
