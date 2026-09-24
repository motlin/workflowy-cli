---
description: Group related tasks — cluster open tasks on both asap ladders by theme, match each cluster against existing project nodes, and walk every proposed move one question at a time. New groups land in the 1st tier with their children ordered by former tier; agenda/ladder duplicates are flagged. Use when the user wants to group, cluster, or consolidate related tasks, or run the group-tasks phase of the daily review.
---

# Group Related Tasks

The ladders fill up with siblings that are really one piece of work: three separate "@Alice onboarding" tasks in three tiers, a "renew passport" next to "book passport photo", a build-time task on the ladder and the same topic sitting in `📋 Meeting agendas`. Ranking them separately spreads one project across the ladder. This phase finds those clusters and pulls each under a single parent, one confirmed move at a time.

Scope is **both** roots linked from `Metadata > ☑️ Next Actions` (`d81ba063-5604-49a5-bb87-0d0fe59d0a48`) — Work and Personal — discovered by link resolution, never hardcoded.

## Do not use the built-in task list

Track progress through `.llm/` files and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) for the per-group work here.

## Run after File Loose Tasks

In the daily review this phase runs right after File Loose Tasks, so every task it considers is already filed on a ladder or in a `⏰` bucket and nothing loose is left to miss. When invoked standalone, run `/gtd:review:daily:file-tasks` first.

## Read the private grouping vocabulary

Which themes the user groups, which clusters they have already declined, and which project nodes absorb which topics are personal, so they live in the gitignored `.llm/gtd/task-groups.md`, never in this plugin. Read it first:

```bash
cat .llm/gtd/task-groups.md 2>/dev/null || true
```

A missing file is a normal first run: propose from the task text alone and create the file when the walk records its first decision. It holds two sections:

- **Themes** — one bullet per theme the user has accepted, with the words that identify it and the node its tasks belong under, e.g. `- onboarding @Alice: "onboarding", "@Alice", "access request" → Work > 📁 Projects (in flight) > Onboarding (<shortId>)`.
- **Declined** — one bullet per cluster the user said no to, with the member names, so the same cluster is never proposed twice, e.g. `- 2026-09-22: "Renew passport" + "Book passport photo" — keep separate`.

## Load the tasks

Resolve both roots and read each root's `⏰` bucket and `📌` ladder exactly as `${CLAUDE_PLUGIN_ROOT}/commands/review/daily/file-tasks.md` does under **Discover the roots**. **Never read from a mirror**: the buckets are mirrored under `Personal > 🔄 Review > 🔄 Daily Review > Set goals for today`, and a mirror's ids are wrong for every write. Confirm `mirror.isMirror` is false on each bucket.

```bash
mkdir -p .llm/gtd/review/proposals
./bin/run.js node get --id <asap-bucket-uuid> --depth 2 --json \
  --fields name,id,shortId,children,completedAt > .llm/gtd/review/ladder-<work|personal>.json
./bin/run.js node get --id <due-bucket-uuid> --depth 1 --json \
  --fields name,id,shortId,children,completedAt > .llm/gtd/review/due-<work|personal>.json
```

Also read each root's `📋 Meeting agendas` children and the project nodes from `.llm/gtd/metadata/projects/work-projects.json` and `personal-projects.json` (their direct children are the projects in flight).

## Cluster by theme

Build clusters **per root** — never group a Work task with a Personal one. A cluster is two or more open tasks that the user would describe as one piece of work. Use the same normalize-and-match rules `${CLAUDE_PLUGIN_ROOT}/commands/review/daily/meetings.md` Step 7 uses (lowercase; strip HTML, `#tags`, `@mentions`, punctuation), then cluster on:

- the same distinctive noun phrase ("passport", "build times", "Q3 roadmap"), even when the verbs differ,
- the same `@person` plus the same topic,
- a theme from the **Themes** section of the vocabulary file.

A shared generic `#tag` (`#code`, `#home`, `#read`) is **not** a theme — it is exactly what replaced category containers, and grouping on it rebuilds them. Skip any cluster listed under **Declined**.

For each cluster, pick the anchor:

- **Existing project node** — when a project in flight (from the projects metadata) matches the theme, or the vocabulary file maps the theme to a node, the members move under that node. No new node is created, and the project stays where it sits.
- **Existing task** — when one member is already the natural parent (it names the whole piece of work and the others are steps of it), the others move under it.
- **New group** — otherwise, a new parent node named for the theme, filed in the **1st tier** of that root's ladder. Grouping is an act of prioritizing: the user just chose to treat this as one project, and a new group that lands low on the ladder disappears. Topic `#tags` shared by every member go on the group's name.

## Order children by former tier

Children of the anchor keep the rank they had: order them by the tier they were on (`1st` members first), then ladder order within a tier. Compute it, and the 1st-tier insertion for a new group, with `planGroup` — never by hand:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/asap-tiers.mjs group .llm/gtd/review/ladder-<work|personal>.json <memberUuid>,<memberUuid>,...
```

`members` is the move order, each with `fromTier` (`null` when it is not on this ladder). `insertion` is the plan for filing a new group in `1st`, computed **after** the members have left their tiers: a member leaving a full `1st` frees the slot the group takes, and a member is never the item a full tier demotes. Ignore `insertion` when the anchor already exists.

**Dated tasks never move.** The due walk (`/gtd:review:daily:due`) reads only the direct children of each `⏰` bucket, so a dated task moved under a group on the ladder silently drops out of it. A `⏰` task that matches a cluster is listed in the question as `Related (stays in ⏰): …` so the user sees the whole theme, but it is never a member. Every member is therefore on the ladder, and a `fromTier: null` in `planGroup` output means an id was mistyped — stop and fix the member list.

## Flag agenda and ladder duplicates

While clustering, compare each root's `📋 Meeting agendas` children against its ladder and `⏰` bucket with the same matching rules. A topic that sits in both is a duplicate — the user will either raise it or do it, and keeping both means one of them never gets closed. Flag each pair as its own question with these options: **Keep both** (the agenda item is a real discussion topic and the task is separate work), **Drop the agenda item**, **Drop the task**, **Skip**. Never delete either side unasked.

## Stage proposals

Write `.llm/gtd/review/proposals/group-tasks.json` following `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Make **no** Workflowy writes while staging.

```json
{
	"task": "group-tasks",
	"generatedAt": "<ISO-8601 with offset>",
	"status": "ready",
	"presentation": "Group related tasks",
	"summary": {"clusters": 2, "duplicates": 1},
	"proposals": [
		{
			"kind": "group",
			"rootKey": "work",
			"theme": "Onboarding @Alice",
			"anchor": {"type": "new", "name": "Onboarding @Alice #work", "tier": 1, "tierId": "<tier-1-uuid>"},
			"insertion": {
				"demotions": [
					{
						"nodeId": "<bumped-uuid>",
						"name": "Draft the rollup RFC",
						"fromTier": 1,
						"toTier": 2,
						"toId": "<tier-2-uuid>"
					}
				],
				"createTiers": []
			},
			"members": [
				{"nodeId": "<uuid>", "name": "Set up 1:1 with @Alice", "fromTier": 2},
				{"nodeId": "<uuid>", "name": "Request repo access for @Alice", "fromTier": 3}
			],
			"relatedDated": [{"nodeId": "<uuid>", "name": "Share the onboarding doc with @Alice", "due": "2026-09-25"}],
			"reason": "all three name @Alice and onboarding"
		},
		{
			"kind": "duplicate",
			"rootKey": "work",
			"agenda": {"nodeId": "<uuid>", "name": "Build times with @Bob"},
			"task": {"nodeId": "<uuid>", "name": "Write up the build-times report #write", "where": "📌 asap → 3rd"},
			"reason": "same distinctive noun phrase: \"build times\""
		}
	]
}
```

`anchor.type` is `new`, `project`, or `task`; `project` and `task` anchors carry `nodeId` instead of `tier` / `tierId`. `status` is `empty` when nothing clusters and nothing duplicates, and `error` if prep failed.

## Walk and apply

Every move is **its own question** — never bundle two clusters, or a cluster and a duplicate, into one `AskUserQuestion` question. Up to 4 questions per call is fine. Go straight into the first proposal: no meta-question about how to scope the walk, and no comment on the count.

For a **group** proposal, show the theme, the anchor and where it lands, each member with its current tier, and the cascade when a new group bumps something out of `1st`:

```markdown
Group 1/2 (Work): Onboarding @Alice → new node in 📌 asap → 1st (2/2 full — bumps "Draft the rollup RFC" to 2nd)

- Set up 1:1 with @Alice (2nd)
- Request repo access for @Alice (3rd)

Related (stays in ⏰): Share the onboarding doc with @Alice (Fri)
```

Options: **Group** (as proposed), **Group under a different anchor** (the user names it), **Drop a member** (the user names it; re-plan with the remaining members), **Keep separate**. Offer a different tier for a new group only when the user asks — `1st` is the rule.

On **Group**, dispatch the ops as one background Bash job per the **Background Dispatch, Verify, and Drain** protocol in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`, chained with `&&` so a failed step stops the chain:

- For a new group: run the `insertion.demotions` first (each a `node move` into the tier below), create any `createTiers`, then `node create --parent-id <tier-1-uuid> --name '<group name>' --position bottom` and read the new node's full UUID from its output.
- Move each member in `members` order: `node move --node-id <memberUuid> --parent-id <anchorUuid> -p bottom`. Moving in that order is what leaves the children sorted by former tier. A member's own children travel with it.
- Do not rename or re-tag any member.

On **Keep separate**, append the cluster to the **Declined** section of `.llm/gtd/task-groups.md` so it is not proposed again. On **Group**, append or update the theme under **Themes** with its identifying words and the anchor's shortId, so the next run recognizes it. Append — never rewrite the file wholesale.

For a **duplicate** proposal, apply the chosen side's delete with `node delete --id <uuid>`, or nothing on **Keep both** / **Skip**.

## Finish

Drain every background job and surface failures by group name. Print one line — e.g. `✓ 2 groups (1 new in 1st, 1 under an existing project), 5 tasks moved, 1 agenda duplicate dropped, 1 kept separate` — or say nothing when `status` was `empty`. Then re-read each ladder and report any capped tier over its `2^k`; a new group in `1st` that left it over cap means a demotion failed.
