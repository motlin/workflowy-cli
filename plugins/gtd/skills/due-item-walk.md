---
name: due-item-walk
description: The one-item-at-a-time walk protocol shared by every dated-item review — presentation rules, banned openers, freeform handling, and the read-before-write requirement. Load when running the Recurring Review's recurring or due segments, or any review that walks a precomputed ordered working set.
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

Use `AskUserQuestion`, never a batch. The user clears items quickly by tapping the first option.

Show the item's group context and overdue math read straight from the working set — never recomputed by hand:

```markdown
**⬆️ Frequently Important** — 8 overdue items

Item 1/8: Record status in workflowy Status (due: 2026-02-09, overdue by 12 days) https://workflowy.com/#/aabb1122
```

- Render embedded URLs as clickable markdown. Parse `<a href="...">text</a>` in the node name and emit `[text](url)`; strip other HTML for display.
- Show the item's own URL when it has one.
- If the item has children, show them indented below.
- After recording an outcome and **dispatching its write in the background**, present the next item immediately — the write never blocks the next `AskUserQuestion`.

## Freeform: note versus continued work

A freeform answer is either a **note** or **continued work**, and they end very differently:

- **Note** — a remark to record and move past ("went well", "waiting on the vendor"). File it as a child node, **dispatched in the background** as a separate job from the outcome write, treat the item as handled, and continue.
- **Continued work** — an instruction, a correction, new information, or a request to keep going on this item ("I plugged in another drive, go inventory it", "that is wrong, redo it"). Stay on the item and do the work. Do **not** write the outcome and do **not** present the next item.

When continued work is in progress, only an explicit "done" or "skip" ends the item. Silence, a completed sub-task, or your own sense that the work looks finished never earns the write. When the answer is genuinely ambiguous, treat it as continued work — resuming a finished item is cheap; recording completion on unfinished work hides it for a whole interval.

## Read the subtree before writing

Before writing into any item, fetch and read its full subtree:

```bash
./bin/run.js node get --id <full-uuid> --depth 4 --json
```

Then conform to what is already there:

- **Match the existing format.** If sibling entries share a shape, the new entry uses that shape rather than one you invent.
- **Match the existing placement.** A new entry belongs alongside its siblings — not appended at the end of the item, and not nested under an unrelated child.
- **Keep instruction children separate from data children.** Nodes that tell you what to do are not entries; never interleave new data into them.
- **Execute conditional instructions whose trigger currently holds.** When the subtree says "if X is present, do Y" and X is present right now, do Y as part of handling the item.

Showing an item's children to the user is not reading them. Skipping this step produces writes that look plausible and are structurally wrong.

## Run staged ops verbatim

Each row in the working set carries its outcome commands already built and shell-escaped. Run them **verbatim**. Do not rebuild a `<time>` element, an `osascript` call, or a `node update` by hand — the script is the source of truth for date math and escaping, and hand-built writes are where wrong weekdays and quoting bugs come from.

Dispatch every write as a background Bash job and follow **Background Dispatch, Verify, and Drain** in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`: track each job, reap finished jobs every ~5 items, surface failures inline by item name, and present the next item without waiting.

## Skip leaves everything unchanged

On skip, write nothing. The item keeps its date and resurfaces on the next run. This is the correct outcome for anything the user did not actually handle — a skipped item the user sees again beats a silently advanced one they never see.

## Finish

Drain all outstanding background writes, then print a one-line summary (`✓ 12 dates advanced`), or list any failed items by name instead of reporting success. Also drain before any step that runs `cache import-api` / `just daily` — an import can clobber items whose API write has not yet landed.
