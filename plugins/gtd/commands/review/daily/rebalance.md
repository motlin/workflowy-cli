---
description: Rebalance both 📌 asap ladders — surface tiers 1-2 as today's goals, then propose push-downs out of over-cap tiers, pull-ups into empty high tiers, and a new bottom tier when the landing zone passes 2^k. Every move is confirmed by the user; nothing is applied automatically. Use when the user wants to review, rerank, or tidy the asap priority ladder, set goals for the day, or run the rebalance phase of the daily review.
---

# Rebalance the Asap Ladders

Read each root's `📌 Tasks (asap)` ladder and bring it back into shape. The demotion cascade in `${CLAUDE_PLUGIN_ROOT}/skills/asap-tiers.md` only fires when something is **inserted** into a full tier; a ladder that has already drifted over cap stays over cap until this phase reads it. This is the phase where the user reranks.

**Every action here is a proposal the user confirms.** Push-downs, pull-ups, and the split that extends the ladder are all presented with the candidates and applied only for the items the user names. Nothing is demoted, promoted, or moved on its own, and no item is ever chosen because of where it sits in the tier -- ranking inside a tier is the user's judgment, not a position.

Scope is **both** roots linked from `Metadata > ☑️ Next Actions` -- Work and Personal -- discovered by link resolution, never hardcoded.

## Do not use the built-in task list

Track progress through `.llm/` files and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) for the per-tier work here.

## Run before anything files onto the ladder

In the daily review this phase runs after the Morning Overview and **before** Process Inbox, File Loose Tasks, and the Recurring Review's due walk. Those phases all put new items onto the ladder; a rebalance that runs after them is stale the moment it finishes, and one that runs before them hands them a ladder whose caps mean something. When invoked standalone, run `/gtd:review:daily:relink` first so nothing is sitting on a `Metadata` link node.

## Read both ladders

Resolve the roots from the metadata anchor, then each root's `📌` bucket, exactly as `${CLAUDE_PLUGIN_ROOT}/commands/review/daily/file-tasks.md` does under **Discover the roots** -- `linkTargets[0].id` of each child of `d81ba063-5604-49a5-bb87-0d0fe59d0a48`, then the `📌`-prefixed child of that root's `✅ Tasks` wrapper. **Never read a ladder off a mirror.** The buckets are mirrored under `Personal > 🔄 Review > 🔄 Daily Review > Set goals for today`, and a mirror's children look right while its id is wrong for every write. Confirm `mirror.isMirror` is false on the bucket you fetch.

```bash
mkdir -p .llm/gtd/review
./bin/run.js node get --id <asap-bucket-uuid> --depth 2 --json \
  --fields name,id,shortId,children,completedAt > .llm/gtd/review/ladder-<work|personal>.json
node ${CLAUDE_PLUGIN_ROOT}/scripts/asap-tiers.mjs rebalance .llm/gtd/review/ladder-<work|personal>.json \
  > .llm/gtd/review/rebalance-<work|personal>.json
```

`rebalance` runs `planRebalance(readLadder(bucket))` and prints one report per ladder:

- `dayPlan` -- tiers `1st` and `2nd` with their items.
- `pushDowns` -- every capped tier (every tier that has a tier below it) over its `2^k`, with **all** of its occupants, `excess` (the minimum that must leave), and the tier below (`toTier` / `toId`).
- `pullUps` -- the run of empty tiers starting at `2nd`, each fed from the first non-empty tier below the run, with that tier's items as `candidates`. `1st` is never a pull-up target.
- `extend` -- the bottom tier once it holds more than `2^k`: the new tier to create, `minimumToMove`, and all of its occupants.

A tier that is missing from the bucket counts as empty with `id: null`; create it with `node create --parent-id <bucket-uuid> --name '<label>' --position bottom` before moving anything into it, so the ladder never has a hole. Never compute a cap or an excess by hand.

If both reports have empty `pushDowns`, empty `pullUps`, and `extend: null`, print the day plan (below) and return -- there is nothing to rebalance.

## Surface the day plan

Tiers `1st` and `2nd` are the goals for the day. Print them for both roots before proposing anything, every run, even when the ladder is in shape:

```markdown
**Today's goals -- Work** 1st (2/2): Ship the rollup RFC · Fix the TV page ordering 2nd (3/4): Draft the Q3 platform plan · Review Alice's design doc · Upgrade the Gradle plugins

**Today's goals -- Personal** 1st (0/2): (empty) 2nd (2/4): Book the dentist · Renew passport
```

Strip HTML for display and render embedded links as markdown. Do not ask whether to work on these; the review is orientation, not execution.

## Walk the proposals, one ladder at a time

Work first, then Personal. Within a ladder, take the report in this order, re-running the `rebalance` command **after each confirmed batch of moves** because every step changes the counts the next one reads: a push-down out of `2nd` can put `3rd` over cap, and a push-down into the bottom tier can push it past `2^k`.

- Push-downs, top tier first.
- Pull-ups.
- Extend.

Present each proposal with `AskUserQuestion`. Never open with a question about how to scope or batch the walk, and never editorialize about how far over cap a tier is -- state the numbers and ask.

### Push down an over-cap tier

Show every occupant of the tier with its short link, then ask which ones move down. The question names the count and the destination; the options are the occupants themselves, multi-select, with no default and no recommendation:

```markdown
**Work 2nd is 6/4 -- at least 2 move down to 3rd.** Which are the lowest priority?

- Draft the Q3 platform plan https://workflowy.com/#/<shortId>
- Review Alice's design doc https://workflowy.com/#/<shortId>
- ...
```

The user may pick more than the minimum, and may answer with items that are not the bottom-most ones. Do not pre-select the last `excess` items and ask for a yes/no -- that is choosing for them. Do not proceed with fewer than `excess` chosen; ask again, naming what is still needed.

**When more must leave than can stay** (`excess > capacity`, the shape of a tier that used to be the bottom and kept growing), invert the question: ask which **up to `capacity`** items **stay**, and everything not named moves down. The user is still naming every item that keeps its rank, and nothing moves until they answer.

Apply confirmed moves with one `node move --node-id <uuid> --parent-id <toId> -p bottom` per item, following **Background Dispatch, Verify, and Drain** in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`. Drain, re-run `rebalance`, and continue with the next tier in the fresh report.

### Pull up into an empty tier

When `pullUps` is non-empty, `2nd` is empty, so there are no goals for the day beyond `1st`. Ask which items from the source tier come up, one target tier at a time:

```markdown
**Personal 2nd is empty.** Pull up from 3rd (5 items) -- which ones become today's goals?
```

Offer the candidates multi-select, plus **Leave it empty**. Cap the selection at the target tier's capacity. When the run covers `2nd` and `3rd` (both empty, feeding from `4th`), fill `2nd` first, then re-run `rebalance` and ask again for `3rd` -- the second question's candidates must not include items that just moved. Create a missing target tier before its first move.

`1st` is never proposed here. Two things the user would drop everything else for, or nothing, is the user's call to make unprompted.

### Extend the ladder

When `extend` is set, the bottom tier is past its bound -- it does not cascade, it grows. The threshold is exact: at `2^k + 1` the ladder needs a `newLabel` tier. Say so, then ask which items move into it:

```markdown
**Work 6th is 97/64 -- the ladder needs a 7th.** At least 33 move into it. Which stay in 6th?
```

The bottom tier is the landing zone, so its occupants are mostly unranked sweeps. Use the inverted question by default: ask which **up to `capacity`** items **stay** in the current bottom tier; everything else goes to the new one. Create the tier first (`node create --parent-id <bucket-uuid> --name '<newLabel>' --position bottom`), then move the unnamed items with `-p bottom` in their current order. Never split on position alone, and never create the tier before the user has confirmed the split.

## Record the outcome

Append one line per ladder to `.llm/gtd/review/rebalance-log.jsonl` -- `{"date", "root", "pushedDown", "pulledUp", "extended", "skipped"}` -- so a later run can see whether a tier is chronically over cap. Do not write anything to Workflowy beyond the confirmed moves and tier creates.

## Finish

Drain every background move and surface failures by item name. Then re-run `rebalance` on both ladders one last time and print one line per root: `✓ Work: 3 pushed down, 0 pulled up, 7th created (33 moved) -- all capped tiers within cap`, or name any capped tier still over cap and any empty `2nd`, because the user declined -- that is a legitimate outcome, not a failure, and the next run proposes it again.
