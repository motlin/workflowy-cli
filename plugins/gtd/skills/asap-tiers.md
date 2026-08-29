---
name: asap-tiers
description: The ordinal priority ladder inside a 📌 Tasks (asap) bucket — tier naming, the fixed 2^k capacity cap, the demotion cascade that fires when a full tier gets a new item, and the category-to-#tag migration. Load when filing, sweeping, or proposing a destination for an undated task in either asap bucket.
---

# Asap Priority Tiers

Each `📌 Tasks (asap)` bucket holds an **ordinal ladder**: children named `1st`, `2nd`, `3rd`, `4th`, `5th`, … Each tier is a rank, not a topic. A task's rank is the only thing its position encodes.

Do the tier arithmetic with `${CLAUDE_PLUGIN_ROOT}/scripts/asap-tiers.mjs` (`readLadder`, `planInsertion`, `tierLabel`, `tierCapacity`, `tiersNeededFor`), never by hand.

## Tiers replaced categories

The buckets used to be split by category — `💻 Coding`, `Administrative`, `✍️ Docs and drafts for me to write`, `🧐 Design docs for my review`, `Platform Upgrades`, `Set up meetings`, `🤖 LLM tasks`, `👤 Personal`, `🏠 Home`, `Reading`. A category tells you what a task _is_; it never tells you whether to do it before the other thirty things in the bucket, so the buckets grew without bound and nothing in them was ever ranked.

Under the ladder, **what a task is moves onto the task text as a `#tag`** and **where it sits is what it ranks**. Tags are searchable and combinable; a container is neither. A tier is readable at a glance without expanding anything.

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

**The caps are fixed, never computed from what the tier below currently holds.** A relative cap is unstable from the bottom — completing two items in `2nd` would retroactively force an item out of `1st`, punishing progress. A fixed `2^k` cap only ever pushes down when something is _added at the top_, which is the forcing function the ladder exists for.

**The bottom tier is the landing zone and is not hard-capped.** Undated tasks swept out of the `⏰` bucket and undated Things "Anytime" tasks arrive there in bulk, so it absorbs overflow rather than cascading into a tier that does not exist yet. Only tiers that have a tier below them are capped. When the bottom tier runs well past `2^k`, propose extending the ladder by one tier and splitting it.

## The demotion cascade

Adding a task to a full tier **requires demoting one of that tier's existing items** to the next tier down. If that tier is also full, its bottom item moves down too, and so on until a tier has room or the bottom tier absorbs the overflow.

`planInsertion(ladder, targetTier)` returns the whole plan — `createTiers` (missing tiers to create first, so the ladder never has a hole), `demotions` (each bumped node with its source and destination tier), and `targetId`. It defaults to demoting each full tier's **bottom-most item**; offer that default in the walk and let the user name a different item instead.

Show the cascade before running it. "Filing this 1st bumps _X_ to 2nd" is the information that makes the user pick the right tier, and hiding it turns a deliberate trade-off into a surprise.

## Choosing a tier

Rank against what is already on the ladder, not in the abstract — the question is never "is this important" but "is this more important than the two things in `1st`".

- `1st` — only if the user would drop the current `1st` items for it.
- `2nd` / `3rd` — real intent to do it soon.
- Bottom tier — everything else, including anything arriving from an automated sweep. A task that showed up on its own has not earned a rank yet.

Default to the bottom tier when the signal is weak. Promotion is cheap; a wrongly promoted task silently demotes something the user chose.

## Migrating a bucket that still has categories

A bucket whose children include category containers is pre-migration data. Migrate it in this order:

- **Identify categories by name, never by "has children."** A category container is one of the known category names listed above. Having children does not make a node a category — most ordinary tasks in these buckets carry children holding research notes, links, and findings, and one work task carries 82 of them. Un-nesting those would dump a task's context into the bucket root and orphan it from the task it explains. Match the name; when a node's name is not on the list, it is a task, however many children it has.
- **Size the ladder.** Count every task in the bucket, including the ones loose at the top level. `tiersNeededFor(count)` gives the depth to build.
- **Confirm the tag mapping.** Propose one `category → #tag` row per category and confirm the whole table with the user in a single question. Prefer a tag already in `.llm/gtd/metadata/tag-frequency.json` or the `🏷️ Context Tags` registry over a newly coined one — `🤖 LLM tasks` → `#llm-task` and `Reading` → `#read` already exist; a category with no established tag needs the user to name it.
- **Never write a name onto a mirror.** A mirror inherits its text from the original and its own `name` is empty. Appending a tag to one gives it text of its own, which the cache rejects — `node get` then refuses to read the entire bucket until it is repaired with `node update --clear-name`. Before tagging, skip any node whose stored name is empty, or whose row in the `mirrors` table has it as `mirror_id`. Tag the **original** instead if the tag belongs on that task at all. Moving a mirror is safe; only renaming is not.
- **Tag, then un-nest.** Append the mapped `#tag` to each task in that category (`node update --name`), then move the task out of the container.
- **Build the ladder and delete the husks.** Create the tiers, then delete each emptied category container.
- **File through the normal walk.** Everything lands in the bottom tier unless the user promotes it — a migration is not a mandate to re-rank forty tasks in one sitting.

Report the migration as a migration, not as routine normalization.
