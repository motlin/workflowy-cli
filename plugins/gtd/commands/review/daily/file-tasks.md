---
description: Normalize both Next-Actions trees, then sweep loose tasks into the ⏰ due-dates / 📌 asap buckets — proposing a destination per task and confirming one at a time. Use when the user wants to file, sort, or organize loose next-action tasks, or run the file-tasks phase of the daily review.
---

# File Loose Tasks

Sweep every Next-Actions root for **loose tasks** — actionable items that aren't yet inside one of the two task buckets — and propose a destination for each: the `⏰ Tasks (due dates)` bucket (with a `Today` / `This week` / `This month` timeframe) or a **priority tier** in the `📌 Tasks (asap)` bucket. Stage the proposals, then walk them one at a time for confirmation, applying only what the user accepts.

The asap bucket is an ordinal ladder (`1st`, `2nd`, `3rd`, …) with a halving capacity cap, not a set of category folders. Read `${CLAUDE_PLUGIN_ROOT}/skills/asap-tiers.md` before proposing any asap destination — it owns the capacity rule, the demotion cascade, and the category-to-`#tag` migration.

Scope is **both** roots linked from `Metadata > ☑️ Next Actions` (`d81ba063-5604-49a5-bb87-0d0fe59d0a48`) — Work and Personal — discovered by link resolution, never hardcoded.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the per-item work here — they clutter the display and are never cleaned up. (Launching **subagents** via the `Task` tool is unrelated and fine.)

## Run relink first

This command assumes loose tasks already sit under the real roots, not on the `Metadata` navigation-link nodes. When invoked standalone, run `/gtd:review:daily:relink` first so any strays on the link nodes land on their targets. The daily review already chains relink ahead of this phase.

## Discover the roots

Resolve both roots from the metadata anchor — each child is a navigation link whose `linkTargets[0]` is the real root:

```bash
mkdir -p .llm/gtd/review/proposals
./bin/run.js node get --id d81ba063-5604-49a5-bb87-0d0fe59d0a48 --depth 1 --json \
  --fields name,shortId,id,children,linkTargets > .llm/gtd/review/next-actions-meta.json
```

**Resolve every destination from these roots, and never from a mirror.** The `⏰` and `📌` buckets are mirrored under `Personal > 🔄 Review > 🔄 Daily Review > Set goals for today`, and a mirror lists its original's children — so tier ids read off a mirror look right. The bucket id itself does not: `node move --parent-id <mirror-uuid>` parents the task **under the mirror**, dropping a one-shot task inside the recurring tree where the due walk then reports it as overdue. Check `mirror.isMirror` is false on any node you are about to write into.

Read `linkTargets[0].id` for each child to get each root's **full UUID** (`☑️ Next (Work)` → `720f876e-fd89-daa9-e341-797f911b8295`, `☑️ Next (Personal)` → `9f832009-a6ad-458e-d9fa-999aabc40472`). Fetch each root deep enough to reach the tasks filed inside the bucket tiers:

```bash
./bin/run.js node get --id <rootUuid> --depth 4 --json \
  --fields id,shortId,name,priority,children > .llm/gtd/review/root-<work|personal>.json
```

## Normalize structure

Every root should match Work's canonical shape before filing:

```text
☑️ Next (…)
├── 📋 Meeting agendas        (container)
├── ✅ Tasks                  (wrapper)
│   ├── ⏰ Tasks (due dates) (…)
│   └── 📌 Tasks (asap) (…)
└── 📄 Drafts                 (container)
```

Detect each piece by **emoji prefix** (`📋` / `✅` / `📄` / `⏰` / `📌`), not exact text — the bucket names carry a `(work)` / `(personal)` suffix. Create only what's missing; resolve full UUIDs via `node get` before any write (writes need the full UUID). This check is idempotent — once both roots match, it's a no-op.

- **`✅ Tasks` wrapper** — if the root already has a `✅ Tasks` child holding the two buckets, leave it. If the buckets are direct children of the root (Personal today), `node create` a `✅ Tasks` child, then `node move` the `⏰` bucket and the `📌` bucket into it, due-dates first.
- **Sibling containers** — ensure `📋 Meeting agendas` and `📄 Drafts` exist as peers of `✅ Tasks`; create any missing one **empty**. Order the three to match Work (`📋 Meeting agendas`, `✅ Tasks`, `📄 Drafts`); since `node move` positions only `top` / `bottom`, sequence the moves to land that order (move `📋` to `top`, then `📄` to `bottom`). Container order relative to loose tasks is cosmetic — loose tasks get filed away below.
- **No timeframe sub-buckets** — the `⏰` bucket holds dated tasks directly. If a `Today` / `This week` / `This month` container is found inside it, that is pre-migration data: move its children up into the bucket, give any child missing a `<time>` the date its container implied (`resolveTimeframe`), then delete the empty container. Report this as a migration, not a routine normalization.
- **Tiers, not categories, in the `📌` bucket** — its children are ordinal tiers `1st`, `2nd`, `3rd`, … If `readLadder` reports category containers (`💻 Coding`, `Administrative`, `👤 Personal`, …) in `unfiled`, that is pre-migration data: run the category-to-`#tag` migration in `${CLAUDE_PLUGIN_ROOT}/skills/asap-tiers.md`, which confirms the tag mapping with the user, tags and un-nests each task, builds the ladder, and deletes the emptied containers. Report this as a migration, not a routine normalization.

Report what was created/moved (or "already normalized") before continuing.

## Collect loose tasks

From each root's JSON, a **loose task** is any actionable item **not already inside** either bucket. Exclude:

- The two bucket containers and all their descendants (asap tiers, leftover category sub-nodes, `Today` / `This week` / `This month`, and the tasks already filed under them).
- The `✅ Tasks` wrapper node itself.
- The structural containers `📋 Meeting agendas` and `📄 Drafts` and their entire subtrees — these are distinct workflows, never swept.
- Provenance / preview children that aren't tasks: `From: …` source lines, link-preview rows (`[p] …`, `[divider]`, `[h1]`, `[table]`, etc.). These are sub-nodes of a task, not loose tasks themselves.

Loose tasks may sit **directly under the root** or **directly under `✅ Tasks`** — collect from both levels. A loose task's own children (sub-steps, notes, provenance) travel with it; never split a task from its children.

## Read the per-root tier ladder

Pass each root's `📌 Tasks (asap)` bucket through `readLadder` from `${CLAUDE_PLUGIN_ROOT}/scripts/asap-tiers.mjs` to get its tiers (rank, label, full UUID, capacity, current occupants) and its `unfiled` children. Never eyeball the occupancy or the cap — how full a tier is decides whether filing into it demotes something, and a miscount silently drops a task the user promoted.

The `⏰ Tasks (due dates)` bucket has **no sub-buckets**. A due-dated task goes directly into the bucket carrying a `<time>` element on the node itself; the timeframe is expressed as a date, not as a container. Capture only the bucket's own full UUID.

## Recommend a destination per task

For each loose task, pick a recommended destination from signals already on the node — no external calls. The due-vs-asap split is a **judgment call**, so the recommendation is a starting point the user confirms or overrides, not a hard rule.

- **Lean `⏰ due-dates`** when any holds: an explicit date / `<time>` or deadline language ("by Fri", "EOD", "before the meeting"); `#agenda`; a senior person asked (`@AliceBrown`, `@BobBrown`, manager); someone is waiting on the user ("blocked on", "waiting", "follow up … report back"); `#next-action`. Then propose a timeframe — explicit/near date → `Today` or `This week`; soft urgency → `This week` or `This month`. **Resolve the timeframe to a concrete date** with `resolveTimeframe` from `${CLAUDE_PLUGIN_ROOT}/scripts/collect-due-items.mjs` (`Today` → today, `This week` → the upcoming Friday, `This month` → the last day of the month) and build its `<time>` element with `buildTimeElement`. Never compute the date or its weekday by hand.
- **Lean `📌 asap` + a tier** otherwise. The tier is a **rank against what is already on the ladder**, not a topic: recommend `1st` or `2nd` only for a task the user would trade against the items already sitting there, and the **bottom tier** for everything else. Default to the bottom tier when the signal is weak — promotion is cheap, but a wrongly promoted task silently demotes something the user chose. Run `planInsertion(ladder, tier)` for the recommended tier and carry its `demotions` and `createTiers` into the proposal so the walk can show the cascade.
- **Topic goes on the text, not in a container.** An asap proposal also carries any missing category `#tag` implied by the task — `#code` for build / PR work, `#write` or `#document` for drafting, `#document` for a doc review, `#meeting` for 1:1 setup, `#jira` for admin, `#home`, `#personal`, `#read`, `#llm-task`. Append only tags the task does not already carry, and only ones already in `.llm/gtd/metadata/tag-frequency.json` or the `🏷️ Context Tags` registry.

Keep the driving signal as a short `reason` string for the walk to show.

## Stage proposals

Write `.llm/gtd/review/proposals/file-tasks.json` following `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` (directory layout, top-level fields). This is a **destination-choice** task, so each proposal carries a recommended destination plus alternatives rather than an Accept/Reject diff. Make **no** Workflowy writes while staging.

```json
{
	"task": "file-tasks",
	"generatedAt": "<ISO-8601 with offset>",
	"status": "ready",
	"presentation": "File loose tasks",
	"summary": {"rootsSwept": 2, "looseFound": 22},
	"proposals": [
		{
			"rootKey": "work",
			"nodeId": "<full-uuid-of-the-loose-task>",
			"header": "OpenRewrite legal",
			"name": "Follow up with Legal on OpenRewrite contribution approval, report back #openrewrite #work",
			"recommended": {
				"destLabel": "⏰ due-dates → This week (2026-08-14)",
				"destUuid": "<due-bucket-uuid>",
				"timeframe": "This week",
				"due": "2026-08-14",
				"position": "bottom"
			},
			"reason": "\"report back\" — someone is waiting",
			"alternatives": [
				{
					"destLabel": "📌 asap → 2nd (4/4 full — bumps \"Draft the rollup RFC\" to 3rd)",
					"destUuid": "<tier-2-uuid>",
					"tier": 2,
					"addTags": ["#code"],
					"demotions": [{"nodeId": "<bumped-uuid>", "fromTier": 2, "toTier": 3, "toId": "<tier-3-uuid>"}],
					"position": "bottom"
				},
				{
					"destLabel": "📌 asap → 5th (bottom)",
					"destUuid": "<tier-5-uuid>",
					"tier": 5,
					"addTags": ["#code"],
					"position": "bottom"
				},
				{
					"destLabel": "⏰ due-dates → This month (2026-08-31)",
					"destUuid": "<due-bucket-uuid>",
					"timeframe": "This month",
					"due": "2026-08-31",
					"position": "bottom"
				}
			],
			"applyOps": [
				"./bin/run.js node update --id <full-uuid-of-the-loose-task> --name '<name with the <time> element appended>'",
				"./bin/run.js node move --node-id <full-uuid-of-the-loose-task> --parent-id <due-bucket-uuid> -p bottom"
			]
		}
	]
}
```

`applyOps` holds the **recommended** destination's commands, escaped and ready to run verbatim, **in order**. A due-dates destination is two ops — stamp the date, then move — because the date lives on the node rather than in a container. An asap destination carries no `timeframe` / `due`; it is any `demotions` first (each a `node move` into the tier below), then a `node update --name` when `addTags` is non-empty, then the move into `destUuid`. Demotions run first so the tier never briefly holds more than its cap. Every `destUuid` is a full UUID read off the ladder; for due-dates that is always the `⏰` bucket itself.

A tier in `createTiers` has no UUID yet, so it cannot be staged as a shell string. Create those tiers during normalization — before staging — and stage against the resulting UUIDs.

Compute `due` from `timeframe` with `resolveTimeframe`, and the `<time>` element with `buildTimeElement`, both from `${CLAUDE_PLUGIN_ROOT}/scripts/collect-due-items.mjs`. A task whose text already carries a `<time>` keeps it — stamp nothing and emit the move alone.

`status` is `empty` when no loose tasks remain (idempotent re-run) and `error` if prep failed.

If invoked with `--dry-run`, stop here: the staged JSON exists and **zero** `node move` calls have run.

## Walk and apply

Present one task at a time via `AskUserQuestion` — **never** open with a meta-question about how to scope, batch, or bulk-handle the walk, and don't editorialize about the count. Go straight into task 1. Group the walk by root, then by recommended bucket, showing position and overdue-style context inline:

```markdown
**Work** — 12 loose tasks

Task 3/12: Follow up with Legal on OpenRewrite approval, report back #openrewrite Recommended: ⏰ due-dates → This week (reason: "report back" = someone waiting) https://workflowy.com/#/<shortId>
```

Options per task (first = the recommended destination): the recommended destination, then 2-3 `alternatives`, then **Skip** (leave the task loose). Render embedded `<a href>` links as markdown so they're clickable; strip other HTML for display.

**Show the cascade in the option label.** When a tier option carries `demotions`, name what gets bumped and where — `📌 asap → 1st (2/2 full — bumps "Fix the TV page ordering" to 2nd)`. The trade-off is the whole point of the cap; an option that hides it turns a deliberate choice into a surprise. If the user wants a different item demoted, take the name they give and rebuild the demotion against that node.

On a destination choice, run that destination's commands — the recommended choice runs `applyOps` verbatim and in order; an alternative runs the same shape rebuilt for the chosen destination (a due-dates alternative stamps its `<time>` first, then moves; an asap alternative runs its `demotions`, then any tag update, then `node move --node-id <taskUuid> --parent-id <chosenDestUuid> -p <position>`). **Dispatch each task's ops as one background Bash job** (`run_in_background: true`) per the **Background Dispatch, Verify, and Drain** protocol in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md` — chain the stamp and the move with `&&` inside a single job so a failed stamp never leaves a task filed under a deadline it doesn't carry. Track each job, reap finished jobs every ~5 tasks, surface failures inline by task name, and present the next task immediately without waiting. On **Skip**, change nothing and move on.

Anything filed into `⏰ due-dates` with a date of today reaches the Recurring Review's due walk later in this same run — that phase ordering is deliberate, so do not try to pre-empt it by asking whether the task is already done.

## Ordering

`node move` positions only `top` / `bottom` — there is no index or sort command. Ordering is therefore coarse: apply accepted moves in walk order with `-p bottom` so tasks append to their destination in the sequence the user confirmed them. Use `-p top` only for destinations that should surface newest-first. Re-sorting a bucket's pre-existing contents is out of scope until the CLI gains `node move --before/--after` or a `node sort`.

## Sweep Things "Anytime" into the personal ladder

Undated personal work accumulates invisibly in the Things "Anytime" list — nothing surfaces it, because nothing is due. The personal asap ladder is meant to be its single home, so after the Workflowy sweep, walk the Anytime backlog into it.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-things-due.mjs > .llm/gtd/review/anytime-things.json
```

The `anytime` array holds undated Anytime tasks with the Today list already deduped out. Each one is a **create-and-complete pair**, not a move: Workflowy and Things are separate stores, so filing means creating the task under the chosen tier and then closing the Things original.

```bash
./bin/run.js node create --parent-id <tier-uuid> --name '<title><tags>' -p bottom
osascript -e 'tell application "Things3" to set status of to do id "<thingsId>" to completed'
```

Append the same kind of topic `#tag` a Workflowy proposal would carry, and nothing more — a Things title arrives untagged, but blanket-tagging every swept task `#personal` says nothing that the personal ladder does not already say.

Default every one of these to the **bottom tier** — a task that has sat undated in Anytime has not earned a rank. Offer a higher tier as an alternative, subject to the same cascade rules. Offer **Skip** (leave it in Things) as well; this list is long and the user is entitled to leave items behind. Never complete the Things task before the Workflowy create succeeds — chain the two with `&&` in one background job so a failed create can't silently destroy the task.

## Finish

Drain all outstanding background moves (wait for jobs, surface any failures), then print a one-line summary — e.g. `✓ 14 tasks filed (9 asap, 5 due-dates), 6 swept from Things Anytime, 3 skipped` — or list failed moves by task name instead of reporting success. If `status` was `empty` and the Anytime list is also empty, say so and skip the walk entirely.

Then re-read each ladder and report any tier over its cap. The bottom tier is allowed to run over between rebalances; any tier above it being over cap means a demotion failed, and that has to be named rather than left to the next run.
