---
name: due-item-walk
description: The one-item-at-a-time walk protocol shared by every dated-item review — presentation rules, the context that must be shown before each question, banned openers, freeform handling, skip-streak cadence changes, and the read-before-write requirement. Load when running the Recurring Review's recurring or due segments, or any review that walks a precomputed ordered working set.
---

# Due-Item Walk

The daily review walks several ordered sets of dated items — recurring review items, one-shot due tasks from Workflowy, Things, and Reminders. They differ in what "done" writes back, but the presentation and the failure modes are identical. This is that shared protocol.

Every walk begins from a **precomputed ordered working set** produced by a script (`compute-overdue.mjs`, `collect-due-items.mjs`). The script has already done the date math, filtering, and ordering. Nothing is left to scope.

## Never ask how to scope the walk

**The volume is never grounds to ask.** Go straight to item 1. No matter how many items are overdue — 40+ is normal and expected — do NOT open with a meta-question offering to bulk-advance, handle "only the stale ones", filter by source, or skip a segment today. The user always walks every item one-by-one and has explicitly asked to stop being asked this.

This includes "summarize the count, then ask how to proceed." Printing a breakdown and then checking in is the same forbidden question wearing a summary. These openers are all banned, however phrased:

- "Walking N one-by-one is a lot / a long haul…"
- "Let me check how you want to handle the volume…"
- "…rather than firing N prompts at you."
- "Should I do the Workflowy ones first and the rest tomorrow?"
- any "that's a lot" / "this is tedious" editorializing about the count.

Printing a one-line count as context for item 1 is fine. Printing a count _and stopping_ is not.

The only correct first move after computing the working set is to present item 1.

## Present one item at a time

Use `AskUserQuestion`, never a batch. The user clears items quickly by tapping the first option. After recording an outcome and **dispatching its write in the background**, present the next item immediately — the write never blocks the next `AskUserQuestion`.

## Show the item, do not just name it

A title is not an item. "Inventory the drives" with 71 children is a different question from the same title with none, and nobody can decide about what they cannot see. Showing it is not extra credit — it is the work of asking. The row already carries the context, staged by the same script that staged the ops:

| Field                     | What it holds                                                         |
| ------------------------- | --------------------------------------------------------------------- |
| `url`                     | the item itself — a Workflowy node, a `things:///show?id=…` deep link |
| `links`                   | every http(s) URL in the item's own name and note                     |
| `note`                    | the node's note, when it has one                                      |
| `modifiedAt`              | when the item last changed                                            |
| `childCount` / `children` | the direct children: title, note, own child count, url                |

Before asking about an item:

- **Open the external links, not the node.** `open` every URL in `links` — a PR, a doc, an article is the thing the item is about, and nothing in the terminal substitutes for it. Chain them into one backgrounded Bash call so nothing waits on the browser.
- **Never open a workflowy.com permalink.** That SPA takes seconds to boot and interrupts whatever the user is doing, to show a node whose text the question already carries. For a row with no children and no note there is nothing there to see at all. Print the link inline as markdown instead and let the user click it if they want it.
- **For a big subtree, open the local mirror.** When a row has enough children that a printed list is unhelpful (roughly 8+, or any child with children of its own), open `https://workflowy.m4.notlin.com/node/<shortId>` — the project's own web app, which serves the same node in ~15ms instead of Workflowy's multi-second load. Fall back to printing the tree if that host does not respond.
- **Fetch the rest of the subtree when one level is not enough.** `children` is depth 1. When any child has children of its own, pull the whole thing before asking:

    ```bash
    ./bin/run.js node get --id <full-uuid> --depth 4 --json
    ```

    This is the same fetch "Read the subtree before writing" already demands. Doing it now means it informs the question instead of only the write.

- **Read what you fetched.** A subtree often answers the question — prior entries say what "done" looks like here, and a conditional instruction whose trigger holds right now is part of handling the item.

Never present an item you have not looked at. An item asked blind gets skipped, and a skipped item comes back tomorrow costing the same question again.

## Print the context block immediately before the question

Terminal output scrolls. Context printed early — before a fetch, before an `open`, before a paragraph of narration — has scrolled off by the time `AskUserQuestion` renders, so it is context the user never saw. Gathering it and then burying it is the same as not gathering it.

The context block is therefore the **last thing** emitted before the `AskUserQuestion` call, with nothing in between: no tool call, no "let me check…", no recap of what you just did. Gather everything first, then print, then ask, as one uninterrupted move.

The block, read straight from the working set and never recomputed by hand:

```text
**⬆️ Frequently Important** — item 3/8

**Inventory the drives** — due 2026-02-09, overdue by 12 days
https://workflowy.com/#/aabb1122 · last changed 2026-06-20 · opened in Workflowy
Note: started from [the spec](https://example.com/spec)
3 children:
    - Drive A (2 children)
    - Drive B — spare
    - Drive C
Skipped 3 runs in a row since 2026-08-11.
```

- Render embedded URLs as clickable markdown. Parse `<a href="...">text</a>` in the node name and emit `[text](url)`; strip other HTML for display.
- List the children. Cap the list around 20 and close with `… and 51 more — open in Workflowy`, so a huge subtree does not push the item's own heading off screen.
- **Completed children are already gone.** `nodeContext()` filters them out and `childCount` is the open count, so read the list as-is. Never read a finished child aloud as a live candidate, and never re-add one you spot in a raw `node get` — a recurring item that mirrors a bucket is mostly finished work, and asking about it wastes the question.
- Say what you opened, so the user knows which tab or app belongs to this question.
- Repeat the deciding facts — overdue math, child count, skip streak — in the `AskUserQuestion` body. The block is terminal output; only the question text survives into the next session.

## Freeform: note, continued work, or retire

A freeform answer is a **note**, **continued work**, or **retire**, and they end very differently:

- **Note** — a remark to record and move past ("went well", "waiting on the vendor"). File it as a child node, **dispatched in the background** as a separate job from the outcome write, treat the item as handled, and continue.
- **Continued work** — an instruction, a correction, new information, or a request to keep going on this item ("I plugged in another drive, go inventory it", "that is wrong, redo it"). Stay on the item and do the work. Do **not** write the outcome and do **not** present the next item.
- **Retire** — an explicit statement that a recurring item should no longer exist. Follow the recurring walk's retire operation, do **not** advance its date, count it as retired, and continue. This class does not apply to one-shot due items; use their **Drop** outcome instead.

When continued work is in progress, only an explicit "done" or "skip" ends the item. Silence, a completed sub-task, or your own sense that the work looks finished never earns the write. When the answer is genuinely ambiguous, treat it as continued work — resuming a finished item is cheap; recording completion on unfinished work hides it for a whole interval.

## Read the subtree before writing

Before writing into any item, fetch and read its full subtree — the same fetch the context block already required, so it is usually still on screen:

```bash
./bin/run.js node get --id <full-uuid> --depth 4 --json
```

Then conform to what is already there:

- **Match the existing format.** If sibling entries share a shape, the new entry uses that shape rather than one you invent.
- **Match the existing placement.** A new entry belongs alongside its siblings — not appended at the end of the item, and not nested under an unrelated child.
- **Keep instruction children separate from data children.** Nodes that tell you what to do are not entries; never interleave new data into them.
- **Execute conditional instructions whose trigger currently holds.** When the subtree says "if X is present, do Y" and X is present right now, do Y as part of handling the item.

Showing an item's children to the user is not reading them. Skipping this step produces writes that look plausible and are structurally wrong.

## Recompute when the date rolls over

A long review crosses midnight, and every staged `applyOp` baked in the local date at the moment prep ran. Running a stale op verbatim writes yesterday's arithmetic — the wrong next date, the wrong weekday label.

Before each segment, compare the prep date staged in `overdue.json` against the current local date. When they differ, re-run `${CLAUDE_PLUGIN_ROOT}/scripts/compute-overdue.mjs --today YYYY-MM-DD` with today's date and walk the fresh rows. This is the same guard `birthdays-prep.md` / `birthdays-apply.md` apply through `generatedFor`.

## Run staged ops verbatim

Each row in the working set carries its outcome commands already built and shell-escaped. Run them **verbatim**. Do not rebuild a `<time>` element, an `osascript` call, or a `node update` by hand — the script is the source of truth for date math and escaping, and hand-built writes are where wrong weekdays and quoting bugs come from.

Dispatch every write as a background Bash job and follow **Background Dispatch, Verify, and Drain** in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`: track each job, reap finished jobs every ~5 items, surface failures inline by item name, and present the next item without waiting.

## Make it recurring

Some one-shot due items are not one-shots at all — they are habits filed in the wrong place. When the user says an item belongs in the recurring review, that is this outcome, not a reschedule.

Ask which `Personal > 🔄 Review` section receives it (⬆️ Frequently Important, Weekly, Monthly, …), move the node under that section, and write the section's cadence `<time>` per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`. Record the outcome as `reschedule` in the skip log so the streak resets.

Non-Workflowy rows take the same shape **Clear a fictional deadline** already uses for Reminders: create the Workflowy recurring node under the chosen section, then delete the Things task or Apple Reminder, and verify both sides before treating the outcome as handled.

## Clear a fictional deadline

Every one-shot due-item walk offers **Clear the date** for a real task whose deadline is fiction. This is a handled outcome, not a skip or reschedule: remove the date entirely and record `clearDate` so the skip streak resets.

The destination depends on the source:

- **Workflowy** moves into a chosen tier of that root's `📌 Tasks (asap)` ladder with its `<time>` removed.
- **Things 3** stays in Things with its due date cleared. Do not ask for a Workflowy tier because the task is not moving to Workflowy.
- **Apple Reminders** cannot clear a due date. Create the task in a chosen Workflowy asap tier, then delete the reminder and verify both sides before treating the outcome as handled.

When the destination is a Workflowy asap ladder, load `${CLAUDE_PLUGIN_ROOT}/skills/asap-tiers.md`, show the current occupants and capacity of each tier, and ask one follow-up tier question using **soon / medium / eventually / bottom** for `1st` / `2nd` / `3rd` / the current bottom tier. Use `readLadder`, `tierCapacity`, and `planInsertion`; show and apply the demotion cascade before filing the task. Never silently choose a tier or hand-calculate capacity.

## Say it in plain words

Everything the walk reports is read by a person, not a maintainer. Describe what happened in ordinary language — "Reminders stopped accepting writes", "the app froze", "the sync never finished". Never use insider terms for failure states: **wedged**, _hung_, _pegged_, _thrashing_, _deadlocked_. If a word would not appear in a note to a friend, it does not belong in a status line.

## Skip leaves everything unchanged

On skip, write nothing. The item keeps its date and resurfaces on the next run. This is the correct outcome for anything the user did not actually handle — a skipped item the user sees again beats a silently advanced one they never see.

## Record every outcome to the skip log

Skipping writes nothing to the item, but it does write to the walk's own memory. After each item, dispatch one record command in the background alongside the outcome write:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/compute-overdue.mjs --record <key> --outcome <skip|done|lengthen|retire|reschedule|clearDate|drop>
```

The key is the recurring row's `id`, or `<source>:<id>` for a one-shot due row (`things:ABC123`, `workflowy:<uuid>`). The log is append-only JSONL at `.llm/gtd/review/skip-log.jsonl`, so concurrent background jobs cannot clobber each other, and repeats within one day collapse instead of inflating a streak.

Record **every** outcome, not just skips — a streak only resets when a handled outcome lands. Skipping the record command for "done" leaves the item looking abandoned on the next run.

## A skip streak means the cadence is wrong, not that the item is dead

Every row carries `skipStreak` (consecutive runs that ended in skip) and `skippedSince`. When `skipStreak >= 2`:

- **Say it in the question body**, read from the row: `Skipped 3 runs in a row since 2026-08-11.` The annotation must live in the question — a streak you only remember from earlier in the conversation is gone by the next session.
- **Promote a cadence change as an explicit outcome**, placed above the ordinary outcomes. Repeatedly skipping an item almost always means it comes back too often, not that it should stop existing. A recurring item lengthens its interval; a one-shot task pushes out to a longer horizon. The segment's own command file names the exact op.
- **Keep retire and drop available, but never as the promoted option.** They are for an item the user says is genuinely dead, not the default reading of a skip streak.

A streak is not a reason to skip the item or to editorialize about the backlog. Present the item, offer the cadence change, and move on.

## Finish

Drain all outstanding background writes, then print a one-line summary (`✓ 12 dates advanced, 2 cadences lengthened`), or list any failed items by name instead of reporting success. Also drain before any step that runs `cache import-api` / `just daily` — an import can clobber items whose API write has not yet landed.
