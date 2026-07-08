---
description: Reference for the daily review's Phase 0 dependency DAG. Use when executing or modifying the LLM Tasks: container — reading the 📥 Import / ⚙️ Prep / 🙋 Presentation groups, fanning prep subagents out in parallel while serializing same-subtree chains, linking each prep to its apply by 🔑 Key, staging proposals, and walking confirmations in fixed sibling order — plus the concurrency cap and shared-state safeguards that keep parallel prep from corrupting the metadata cache.
globs: ${CLAUDE_PLUGIN_ROOT}/commands/review/**
---

# DAG LLM Tasks

The daily review's Phase 0 (`${CLAUDE_PLUGIN_ROOT}/commands/review/daily.md`) runs the `LLM Tasks:` container at `Personal > 🔄 Review > 🔄 Daily Review > LLM Tasks:`. The work splits along two independent axes:

- **Prep order** — governed by dependency edges. Branches that write disjoint Workflowy subtrees prep in parallel; branches that write the **same** subtree must be serialized.
- **Presentation order** — a fixed, design-time canonical rank the user tunes by dragging nodes, decoupled from which prep subagent happens to finish first.

So Phase 0 is a **dependency DAG**, not flat parallelism. The container's **tree shape encodes the rules** — there are no integer flags or `After` edges. The user tunes everything by editing/dragging Workflowy nodes.

Mechanism is **subagents** (the Agent/Task tool), not Workflow and not Teammates. Subagents are already this repo's parallelism pattern (`gtd:refine-inbox` fans out `item-refiner`s; `gtd:journal` / `gtd:capture` run scanners in parallel).

## The Container Structure Encodes the Rules

The `LLM Tasks:` container is restructured into **grouping parents** so the tree shape itself expresses parallelism and order:

```text
LLM Tasks:
  📥 Import latest workflowy data        ← barrier: runs first, inline, drains before anything else
  ⚙️ Prep (runs in parallel)             ← leaf children fan out concurrently; order doesn't matter
    🔗 Calendar journal — serial chain   ← a CHAIN sub-group: children run top-to-bottom (same subtree)
       Otter → Journal · auto  (🤖 Auto) ← creates deduped meetings inline (no gate); briefing only
       Refine calendar journal · prep
       Refine #exercise · prep
    Refine inbox · prep                  ← writes 🔍 suggestion nodes (no presentation entry of its own)
    Scan email for events · prep         ← stages candidate events
    🎂 Birthdays · prep  (🤖 Auto)        ← autonomous prep+apply; briefing only, never prompts
  🙋 Presentation (top-to-bottom = ask order)   ← interactive applies, presented in SIBLING ORDER
    Scan email for events · apply        ← confirm each event
    Refine calendar journal · apply      ← batches of 4
    Refine #exercise · apply             ← batches (placed below refine-journal → presented after it)
    Process inbox · apply                ← accept/move per item; LAST
```

### Structural rules the executor reads

- **The first child (`📥 Import`) is the barrier.** It runs inline and must drain all background date-writes before any prep starts. Nothing else begins until it completes.
- **Leaf children of `⚙️ Prep` run in parallel** (order irrelevant), bounded by the ≤5 [concurrency cap](#concurrency-cap).
- **A branch child of `⚙️ Prep` marked `🔗 … serial chain` is an ordered sub-chain.** Its children run **top-to-bottom**, each waiting for the prior to return, because they write the **same** Workflowy subtree. Nesting encodes seriality — no `After` edges needed. (See [Why the calendar chain is serial](#why-the-calendar-chain-is-serial).)
- **`🤖 Auto` prep tasks have no Presentation entry.** They run their full autonomous work (prep **and** apply) and stage a **briefing fragment** instead of prompting.
- **Children of `🙋 Presentation` are the confirmation walk, in literal sibling order.** Drag to reorder; order matters here and **only** here. A dependency like "exercise reformatting must be presented after refine-journal" is satisfied just by placing exercise's node below refine-journal's.

### Prep↔apply linkage (`🔑 Key`)

A prep node and its presentation node are linked by a shared `🔑 Key: <slug>` child on both (`refine-journal`, `exercise`, `email-calendar`, `process-inbox`). `🤖 Auto` tasks (`birthdays`, `otter-journal`) carry a `🔑 Key` too, but they stage a briefing fragment instead of a paired proposal and have no presentation node.

- The **prep** node stages `.llm/gtd/review/proposals/<key>.json` (schema and the shared apply routine live in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`).
- The **presentation** node reads that staged file by the same key.
- `Process inbox · apply` reads refine-inbox's `🔍` suggestion nodes in Workflowy rather than a JSON file, but the key-linkage idea is the same.
- Some tasks advance a **scanner cursor**. `Otter → Journal · auto` (a `🤖 Auto` task) runs the `otter-journal-scanner` in `create` mode, which creates the deduped meetings under `📆 Calendar` and advances the live `Metadata > ⚙️ Scanner State > otter-journal-scanner` cursor in the **same** run — the cursor advances only after the meetings it covers exist, so a failed/empty run leaves it untouched and the work resurfaces. Cursor-based dedup is primary, with calendar-match the backstop.

## Execution Algorithm (run by the main thread)

### 0a — Barrier

Run the `📥 Import` node inline (`op run -- just daily` + `cache sync-node`). Drain all background date-writes per the protocol in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`. Nothing else starts until this completes — the fan-out reads the cache this import just rewrote. The daily-review command runs this step before its container fetch; when it already ran, start at 0b.

**Verify the barrier, never assume it (see `commands/review/daily.md` → "Never work around a failure — HALT").** Do not pipe `op run -- just daily` through `tail`/`head` (that masks the real exit code). Confirm `cache import-api` printed its `Fetched N … / +A ~U =… -D` summary and that today's data is present (e.g. today's calendar date node exists). If the import errored, hung, or cannot be positively verified, **HALT the review** — do not fan out on a stale cache, and do not silently recover by re-running sub-steps yourself. Fix the cause (or ask the user) and re-run the barrier from the top.

### 0b — Read the groups

Walk the filtered container:

- `⚙️ Prep` — leaf children = parallel tasks; each `🔗 … serial chain` branch child = an ordered sub-chain.
- `🙋 Presentation` — children, **in sibling order**, = the confirmation walk.

For each node read its `🔑 Key` and whether it is `🤖 Auto`. Skip nodes whose `<time>` / skip-gate excludes them (filtering does not split or merge a group — a skipped node just doesn't run).

### 0c — Metadata-sync once

Run `metadata-sync` **once** before fan-out (existing safeguard). Subagents read the resulting `.llm/gtd/metadata/` cache; they never rebuild it.

### 0d — Prep fan-out (≤5, background)

Launch prep work in the **background**, then return control to the main thread as soon as every runnable branch has an in-flight controller. Do **not** join on the whole prep fan-out here. The next section's confirmation walk starts while prep is still running.

Dispatch one background prep unit for each top-level runnable branch under `⚙️ Prep`: direct leaf children get their own prep subagent, and each `🔗 … serial chain` gets one controller. The chain controller runs its children's prep **one after another** (each waits for the prior to return). Each subagent runs the task's **prep command** (e.g. `refine-journal-prep`) under the [prep subagent contract](#prep-subagent-contract):

- autonomous only, no `AskUserQuestion`;
- read-don't-rebuild metadata;
- write only its own subtree;
- **stage proposals to `.llm/gtd/review/proposals/<key>.json`** and return a summary.

`🤖 Auto` tasks run their full autonomous work and stage a **briefing fragment** (`.llm/gtd/review/briefings/<key>.json`) instead of staging a confirmable proposal.

Max concurrent prep at fan-out = head-of-chain (otter auto) + refine-inbox + email-calendar + birthdays = 4 (≤5 holds; the chain advances serially as the other branches continue in the background).

### 0e — Confirmation walk (hybrid timing)

Start this walk immediately after 0d dispatches the background prep controllers; do **not** wait for all prep branches to finish first. Walk `🙋 Presentation` children **in sibling order**. For each task:

- **Block only until this task's own prep is ready** — wait for `.llm/gtd/review/proposals/<key>.json` (or the task's key-linked readiness signal) for the current presentation item, even if a later sibling finished first. The order is fixed by the tree, not by races.
- Continue reaping finished background prep controllers as they complete, but never impose a whole-fan-out barrier before the first or next question.
- Run the task's **apply command** (e.g. `refine-journal-apply`), which reads the staged file, presents batched confirmations, applies accepted ops, and advances the task's date (background dispatch, per `review-date-updates.md`).

`Process inbox · apply` is last.

### 0f — Drain + summarize

Drain all background date-writes before Phase 1. Print the summary plus the folded-in `🤖 Auto` briefing fragments.

## Prep Subagent Contract

Every prep subagent is told, explicitly:

- **Autonomous prep only.** Do the task's autonomous half — scan sources, compute proposals — but do **not** apply anything that requires the user's sign-off. (`🤖 Auto` tasks are the exception: they do their full autonomous apply and stage a briefing fragment.)
- **No `AskUserQuestion`.** Subagents cannot prompt the user. If a decision needs the user, record it as an `ambiguity` in the staged proposal — do not guess and do not block.
- **Stage to disk, not the chat.** Write `.llm/gtd/review/proposals/<key>.json` (or `briefings/<key>.json` for `🤖 Auto`) per the schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Each proposal carries enough detail (node ids, full before/after, exact `applyOps`) for the walk to apply accepted items **without re-deriving** them. Return a one-line status summary in the final message.
- **Read, never rebuild, the metadata cache.** The single `metadata-sync` already ran; rebuilding it concurrently corrupts it.
- **Write only this task's own Workflowy subtree** via `./bin/run.js node update --id <node-id>` (and the other `node` write subcommands) — never edit SQLite directly. Prep that only stages JSON makes no Workflowy writes at all.

## Concurrency Cap

One subagent per leaf prep task (and one in flight per serial chain), capped at **≤ 5** total in flight. This stays within the ~5 cadence advised by `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`: the API client retries on HTTP 429 (`packages/shared/src/api/workflowy-client.ts`), and ~5 keeps the number of spawned Node processes reasonable.

## Graceful Degradation

A task whose skill has **no separable autonomous phase** must still work, just without speedup:

- Its prep subagent stages a proposal with `status: "needs-interactive"` (and does no partial work that would need undoing).
- The walk runs that task **inline at its presentation slot**, exactly as a fully interactive task.

This guarantees the group structure never breaks a task — at worst it provides no parallelism.

## Why the Calendar Chain Is Serial

`otter-journal`, `refine-journal`, and the `#exercise` pass all write the **same** calendar subtree, so their prep cannot run as parallel siblings:

- `otter-journal` **adds** calendar entries.
- `refine-journal` **tags / refines** those entries.
- the `#exercise` pass **re-formats** entries `refine-journal` just touched (its own note says it runs "even if exercise entries were recently refined by another task").

Running them concurrently would have two subagents writing the same nodes and would let `refine-journal` tag entries `otter` hasn't added yet, or `exercise` reformat entries `refine-journal` hasn't refined yet. Nesting them under `🔗 Calendar journal — serial chain` makes them run top-to-bottom (otter auto → refine prep → exercise prep), so each sees the prior's output — and because `otter-journal` now **creates** its meetings inline (in `create` mode), the refine preps later in the same chain see the newly-added entries this run. The matching presentation rule — exercise placed below refine-journal under `🙋 Presentation` — keeps the confirmation walk in the same dependency order (`otter-journal` no longer has a presentation entry).

## Safeguards (Bake These In)

- **Single metadata-sync.** `refine-journal` and `refine-inbox` both rebuild `.llm/gtd/metadata/`; concurrent rebuilds corrupt it. Run `metadata-sync` **once** before fan-out; subagents read the cache only.
- **Drain before fan-out.** The `📥 Import` barrier's `cache import-api` / `just daily` overwrites local SQLite from the API (write-through model). All of the import **and** every pending background date-write must drain **before** any prep fan-out begins — the fan-out reads the cache the import just rewrote. This extends the "drain before any cache reimport" rule in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`.
- **Distinct write targets.** Parallel prep branches write different Workflowy subtrees (inbox suggestion children, candidate-event staging, briefing fragments); same-subtree writers are serialized into the `🔗 … serial chain` instead of fanned out. The only other shared mutable state is the metadata cache, handled by the single-sync rule above.
- **Prep-ready blocking, not race ordering.** The walk starts as soon as prep controllers are dispatched, presents in `🙋 Presentation` sibling order, and **blocks only on each current task's prep** even if a later sibling finished first — so the user always sees the same canonical order without waiting for the slowest unrelated prep branch before the first question.
- **Slow-prep visibility.** If a branch delays the walk at its own presentation slot, report which key is still pending and how long it has been running. The calendar serial chain can be slow because its tasks intentionally run one after another; refine-inbox can be slow because it fans out item refinement. Those branches should be measured at their own slots, not used as a reason to barrier earlier ready proposals.
- **Concurrency cap.** Keep total in-flight prep at ≤ 5 (see [Concurrency Cap](#concurrency-cap)) to bound 429s and Node process count.

## CLI Payload Sizing (Keep Trees Out of Context)

`node get --json` output grows **super-linearly** with `--depth`, and dumping it into a subagent's context burns tokens fast. Measured on one node:

| call                                          | ~tokens        |
| --------------------------------------------- | -------------- |
| `--depth 3 --fields name,shortId,id,children` | ~5.9K          |
| `--depth 3` (no `--fields`)                   | ~27.7K         |
| `--depth 5 --fields ...`                      | ~276K          |
| `--depth 10`                                  | breaks (empty) |

Two rules when fetching nodes:

- **Always pass `--fields`** listing only what the caller parses (saves ~78% at a given depth). Common set: `id,shortId,name,note,completedAt,children`. (`node search` has no `--fields` — cap it with `--limit` instead.)
- **For deep trees, redirect to a file and `jq` the slice** rather than holding the tree in context — e.g. `node get --id <id> --depth 10 --json --fields ... > .llm/gtd/.../tree.json`, then parse the file. This matches the `node search … > /tmp/*.json` pattern already used for high-volume reads.
