---
name: asap-tiers
description: The ordinal priority ladder inside a 📌 Tasks (asap) bucket — tier naming, the fixed 2^k capacity cap, the rule that filing into a full tier never moves another item, and the category-to-#tag migration. Load when filing, sweeping, or proposing a destination for an undated task in either asap bucket.
---

# Asap Priority Tiers

Each `📌 Tasks (asap)` bucket holds an **ordinal ladder**: children named `1st`, `2nd`, `3rd`, `4th`, `5th`, … Each tier is a rank, not a topic. A task's rank is the only thing its position encodes.

Do the tier arithmetic with `${CLAUDE_PLUGIN_ROOT}/scripts/asap-tiers.mts` (`readLadder`, `planInsertion`, `planRebalance`, `planGroup`, `tierLabel`, `tierCapacity`, `tiersNeededFor`), never by hand.

## Rank by position, describe by tag

**What a task is goes on the task text as a `#tag`**; **where it sits is what it ranks**. Tags are searchable and combinable; a container is neither. A tier is readable at a glance without expanding anything.

## The halving cap

Tier `k` holds **at most `2^k`** items:

| Tier  | Capacity | Cumulative |
| ----- | -------- | ---------- |
| `1st` | 2        | 2          |
| `2nd` | 4        | 6          |
| `3rd` | 8        | 14         |
| `4th` | 16       | 30         |
| `5th` | 32       | 62         |

Each tier holds at most half of the tier below it. That is what makes the top of the ladder mean something: `1st` is two tasks, not a wish list.

**The caps are fixed, never computed from what the tier below currently holds.** A relative cap is unstable from the bottom — completing two items in `2nd` would retroactively force an item out of `1st`, punishing progress.

**The bottom tier is the landing zone and is not hard-capped.** Undated tasks swept out of the `⏰` bucket and undated Things "Anytime" tasks arrive there in bulk, so it absorbs overflow. Only tiers that have a tier below them are capped. When the bottom tier goes past `2^k`, propose extending the ladder by one tier and splitting it. The threshold is exact, not a judgment call: at `2^k + 1` the ladder needs another tier.

## Filing into a full tier

Filing a task into a tier **only inserts that task**. It never demotes, bumps, or moves any other item, even when the tier is already at or over its cap. The tier simply runs over cap, and the user fixes it later on the ladder page during `/gtd:review:daily:rebalance`.

`planInsertion(ladder, targetTier)` returns `createTiers` (missing tiers to create first, so the ladder never has a hole) and `targetId`. Nothing else.

Occupancy such as `3rd 8/8` may be shown as a plain fact. Never describe a filing as bumping or demoting something, never propose a cascade, and never treat a full tier as a reason to ask a confirming question. When the user names a tier, file there.

## Rebalancing a ladder that has drifted

A ladder that is already over cap -- a tier that grew while it was the bottom and then got a tier below it, or one the user filed into while it was full -- stays that way until the `/gtd:review:daily:rebalance` phase reads it. `planRebalance(ladder)` (`asap-tiers.mts rebalance <bucket.json>` from the shell) reports the day plan (tiers `1st` and `2nd`), every capped tier over `2^k` with all of its occupants, the run of empty tiers starting at `2nd` with the candidates to pull up from below, and the bottom tier once it passes `2^k` with the new tier to create. It picks nothing: which items leave a tier is the user's judgment, so the report carries occupants, never victims, and the phase applies only what the user names.

## Choosing a tier

Rank against what is already on the ladder, not in the abstract — the question is never "is this important" but "is this more important than the two things in `1st`".

- `1st` — only if the user would drop the current `1st` items for it.
- `2nd` / `3rd` — real intent to do it soon.
- Bottom tier — everything else, including anything arriving from an automated sweep. A task that showed up on its own has not earned a rank yet.

Default to the bottom tier when the signal is weak. Promotion is cheap, and the user reranks during rebalance. Keep promotion cheap in every walk that files onto the ladder: `filingChoices(ladder)` (`asap-tiers.mts choices <bucket.json>`) returns the bottom tier, the tier directly above it as a one-click promotion, and a one-line occupancy summary for the question text.

## Migrating a bucket that still has categories

A bucket whose children include category containers needs migrating into the ladder. Migrate it in this order:

- **Identify categories by name, never by "has children."** A category container is one of these names: `💻 Coding`, `Administrative`, `✍️ Docs and drafts for me to write`, `🧐 Design docs for my review`, `Platform Upgrades`, `Set up meetings`, `🤖 LLM tasks`, `👤 Personal`, `🏠 Home`, `Reading`. Having children does not make a node a category — most ordinary tasks in these buckets carry children holding research notes, links, and findings, and one work task carries 82 of them. Un-nesting those would dump a task's context into the bucket root and orphan it from the task it explains. Match the name; when a node's name is not on the list, it is a task, however many children it has.
- **Size the ladder.** Count every task in the bucket, including the ones loose at the top level. `tiersNeededFor(count)` gives the depth to build.
- **Confirm the tag mapping.** Propose one `category → #tag` row per category and confirm the whole table with the user in a single question. Prefer a tag already in `.llm/gtd/metadata/tag-frequency.json` or the `🏷️ Context Tags` registry over a newly coined one — `🤖 LLM tasks` → `#llm-task` and `Reading` → `#read` already exist; a category with no established tag needs the user to name it.
- **Tagging a mirror tags its original.** A mirror has no text of its own; it always shows its original's name, and `node update` on a mirror id writes to the original. So a tag appended through a mirror appears on the original and every other mirror of it. Tag a mirror only if the tag belongs on the original task everywhere it appears. Moving a mirror moves only that mirror.
- **Tag, then un-nest.** Append the mapped `#tag` to each task in that category (`node update --name`), then move the task out of the container.
- **Build the ladder and delete the husks.** Create the tiers, then delete each emptied category container.
- **File through the normal walk.** Everything lands in the bottom tier unless the user promotes it — a migration is not a mandate to re-rank forty tasks in one sitting.

Report the migration as a migration, not as routine normalization.
