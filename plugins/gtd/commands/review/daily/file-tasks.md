---
description: Normalize both Next-Actions trees, then sweep loose tasks into the ⏰ due-dates / 📌 asap buckets — proposing a destination per task and confirming one at a time. Use when the user wants to file, sort, or organize loose next-action tasks, or run the file-tasks phase of the daily review.
---

# File Loose Tasks

Sweep every Next-Actions root for **loose tasks** — actionable items that aren't yet inside one of the two task buckets — and propose a destination for each: the `⏰ Tasks (due dates)` bucket (with a `Today` / `This week` / `This month` timeframe) or the `📌 Tasks (asap)` bucket (with a category). Stage the proposals, then walk them one at a time for confirmation, applying only what the user accepts.

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

Read `linkTargets[0].id` for each child to get each root's **full UUID** (`☑️ Next (Work)` → `720f876e-fd89-daa9-e341-797f911b8295`, `☑️ Next (Personal)` → `9f832009-a6ad-458e-d9fa-999aabc40472`). Fetch each root deep enough to reach the bucket category / timeframe leaves:

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

Report what was created/moved (or "already normalized") before continuing.

## Collect loose tasks

From each root's JSON, a **loose task** is any actionable item **not already inside** either bucket. Exclude:

- The two bucket containers and all their descendants (category sub-nodes, `Today` / `This week` / `This month`, and the tasks already filed under them).
- The `✅ Tasks` wrapper node itself.
- The structural containers `📋 Meeting agendas` and `📄 Drafts` and their entire subtrees — these are distinct workflows, never swept.
- Provenance / preview children that aren't tasks: `From: …` source lines, link-preview rows (`[p] …`, `[divider]`, `[h1]`, `[table]`, etc.). These are sub-nodes of a task, not loose tasks themselves.

Loose tasks may sit **directly under the root** or **directly under `✅ Tasks`** — collect from both levels. A loose task's own children (sub-steps, notes, provenance) travel with it; never split a task from its children.

## Build the per-root taxonomy

Read each root's `📌 Tasks (asap)` bucket and capture its existing **category children** verbatim (full UUID + label) — this is the only allowed category set for that root (Work: `Platform Upgrades`, `Set up meetings`, `Administrative`, `🧐 Design docs for my review`, `✍️ Docs and drafts for me to write`, `💻 Coding`, …; Personal: `👤 Personal`, `🏠 Home`, …). Read the `⏰ Tasks (due dates)` bucket's `Today` / `This week` / `This month` sub-buckets (full UUIDs). Never invent a category — if nothing fits, the destination is the top of the asap bucket itself (uncategorized).

## Recommend a destination per task

For each loose task, pick a recommended destination from signals already on the node — no external calls. The due-vs-asap split is a **judgment call**, so the recommendation is a starting point the user confirms or overrides, not a hard rule.

- **Lean `⏰ due-dates`** when any holds: an explicit date / `<time>` or deadline language ("by Fri", "EOD", "before the meeting"); `#agenda`; a senior person asked (`@AliceBrown`, `@BobBrown`, manager); someone is waiting on the user ("blocked on", "waiting", "follow up … report back"); `#next-action`. Then propose a timeframe — explicit/near date → `Today` or `This week`; soft urgency → `This week` or `This month`.
- **Lean `📌 asap` + category** otherwise, matching that root's taxonomy by tag / keyword: `#code` / build / PR work → `💻 Coding`; `#write` / `#document` / drafting → `✍️ Docs and drafts for me to write`; "review … doc" / `#document by` → `🧐 Design docs for my review`; meeting or 1:1 setup → `Set up meetings`; jira / admin → `Administrative`; platform-upgrade work → `Platform Upgrades`; `#home` → `🏠 Home`; personal/family → `👤 Personal`. No match → top of the asap bucket, uncategorized.

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
				"destLabel": "⏰ due-dates → This week",
				"destUuid": "<timeframe-uuid>",
				"position": "bottom"
			},
			"reason": "\"report back\" — someone is waiting",
			"alternatives": [
				{"destLabel": "📌 asap → 💻 Coding", "destUuid": "<category-uuid>", "position": "bottom"},
				{"destLabel": "📌 asap (uncategorized)", "destUuid": "<asap-bucket-uuid>", "position": "top"},
				{"destLabel": "⏰ due-dates → This month", "destUuid": "<timeframe-uuid>", "position": "bottom"}
			],
			"applyOps": [
				"./bin/run.js node move --node-id <full-uuid-of-the-loose-task> --parent-id <timeframe-uuid> -p bottom"
			]
		}
	]
}
```

`applyOps` holds the **recommended** move, escaped and ready to run verbatim. Every `destUuid` (recommended and alternatives) is a full UUID resolved during taxonomy-building. `status` is `empty` when no loose tasks remain (idempotent re-run) and `error` if prep failed.

If invoked with `--dry-run`, stop here: the staged JSON exists and **zero** `node move` calls have run.

## Walk and apply

Present one task at a time via `AskUserQuestion` — **never** open with a meta-question about how to scope, batch, or bulk-handle the walk, and don't editorialize about the count. Go straight into task 1. Group the walk by root, then by recommended bucket, showing position and overdue-style context inline:

```markdown
**Work** — 12 loose tasks

Task 3/12: Follow up with Legal on OpenRewrite approval, report back #openrewrite Recommended: ⏰ due-dates → This week (reason: "report back" = someone waiting) https://workflowy.com/#/<shortId>
```

Options per task (first = the recommended destination): the recommended destination, then 2-3 `alternatives`, then **Skip** (leave the task loose). Render embedded `<a href>` links as markdown so they're clickable; strip other HTML for display.

On a destination choice, run that destination's move — the recommended choice runs `applyOps` verbatim; an alternative runs `node move --node-id <taskUuid> --parent-id <chosenDestUuid> -p <position>`. **Dispatch each move as a background Bash job** (`run_in_background: true`) per the **Background Dispatch, Verify, and Drain** protocol in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`: track each job, reap finished jobs every ~5 tasks, surface failures inline by task name, and present the next task immediately without waiting. On **Skip**, change nothing and move on.

## Ordering

`node move` positions only `top` / `bottom` — there is no index or sort command. Ordering is therefore coarse: apply accepted moves in walk order with `-p bottom` so tasks append to their destination in the sequence the user confirmed them. Use `-p top` only for destinations that should surface newest-first. Re-sorting a bucket's pre-existing contents is out of scope until the CLI gains `node move --before/--after` or a `node sort`.

## Finish

Drain all outstanding background moves (wait for jobs, surface any failures), then print a one-line summary — e.g. `✓ 14 tasks filed (9 asap, 5 due-dates), 3 skipped` — or list failed moves by task name instead of reporting success. If `status` was `empty`, say so and skip the walk entirely.
