---
description: Daily review orchestrator — run the full morning routine in order: execute due automated LLM tasks, relink orphaned items, review meeting follow-ups, give the morning overview, walk overdue recurring review items, and file loose tasks. Use whenever the user asks to do, start, or run their daily review or morning GTD routine.
---

# Daily Review

Run the full daily review: execute overdue LLM tasks, tidy misfiled items off the navigation links, then get oriented with the morning overview and process any overdue recurring review items.

The Meeting Follow-up Review, Morning Overview, and Recurring Review phases delegate to `/gtd:review:daily:meetings`, `:overview`, and `:due`, each of which already carries the "do not use the built-in task list" rule — don't create built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) for the LLM Tasks phase either.

## When a skill breaks, fix the skill first

If you discover a bug in a skill, command, or script **while running the review** — a script that errors, a command that does the wrong thing, a wrong assumption baked into these docs — stop the review and fix the skill first, then resume. Do not work around it inline and press on. Fixing the skill is red/green TDD (write the failing test, fix, run `vp check` / `vp test` per the project precommit checklist), and it takes priority over finishing the day's review, because every future run benefits. This is distinct from a data/MCP failure (see [Handling failures](#handling-failures)); that path is about pausing and asking, this one is about the tooling itself being wrong.

## Never work around a failure — HALT

**This is the highest-priority rule in the review. Read it as absolute.**

When _any_ step fails — a command errors, a script exits non-zero, an MCP is down, a network call hangs, or the data cannot be positively verified as fresh — **STOP the review immediately and surface the failure to the user.** Do **not**:

- work around it by running sub-steps yourself (e.g. the recipe failed, so you run `import-api` by hand),
- proceed on a stale, partial, or degraded cache/dataset,
- treat "the process exited" or "exit code 0" as success. A piped `… | tail` reports **tail's** exit code, not the command's; and a process can exit 0 having synced nothing. **Verify the actual result**, never a proxy for it.

"Continuing" is a decision that must be **earned by positive verification**, never assumed. If you cannot verify success, you have not succeeded — halt. Silently recovering or pressing on with degraded data corrupts every downstream step (a stale cache makes refinement skip the newest entries, dedup re-propose handled items, and dates advance on work that never happened). A halted review the user can re-run beats a completed review built on sand.

### The 📥 Import barrier must be _verified_, not assumed

The `📥 Import` barrier exists so the whole fan-out reads **today's** data. Before any prep fan-out:

- Run the import **without masking its exit code** (do not pipe the barrier command through `tail`/`head`; capture output to a file and read it, or check `${PIPESTATUS[0]}`).
- **Positively verify the live API sync landed:** `cache import-api` printed its `Fetched N nodes … / +A added, ~U updated, =… unchanged, -D deleted` summary, the node count is sane, and today's data is actually present (e.g. today's calendar date node exists). Exit code alone is insufficient.
- If the import errored, hung, or cannot be verified, **HALT** — do not fan out on a stale cache. Fix the cause (or ask the user to) and re-run the barrier from the top.

## Phase 0: LLM Tasks

Run the `📥 Import` barrier first (step 0a in the DAG skill — it's mandatory, and the fetch must read a fresh cache), then fetch the canonical `LLM Tasks:` container and run any items whose date is on or before today. These are automated tasks that should run before the human-oriented review.

The LLM Tasks phase is a **dependency DAG**, not a flat list. The container's tree shape encodes parallelism and order: a `📥 Import` barrier, an `⚙️ Prep` group whose leaf children prep in parallel (with a `🔗 … serial chain` sub-group for same-subtree writers), and a `🙋 Presentation` group walked in fixed sibling order. The group-parsing, prep fan-out, staging contract, confirmation walk, and shared-state safeguards live in `${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md`; the on-disk proposal/briefing schema and the shared apply routine live in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. This command keeps barrier / fetch / filter / skip-gate and invokes those skills.

### Fetch

Reads the cache the barrier just rewrote:

```bash
mkdir -p .llm/gtd/review
./bin/run.js node get --path "Personal,🔄 Review,🔄 Daily Review,LLM Tasks:" --depth 6 --json --fields name,shortId,id,children,completedAt > .llm/gtd/review/phase0-llm-tasks.json
```

Depth 6 reaches the chain grandchildren and each node's `🔑 Key` / `🤖 Auto` marker children. The container's children are the groups `📥 Import …`, `⚙️ Prep …`, and `🙋 Presentation …` (matched by leading emoji, not exact text — the user may retitle them).

### Filter

The skip-gate works at the **task** level (the prep leaves and presentation children), not the group parents. Keep a task only if it:

- Has a `<time>` element in its name with a start date on or before today
- Has `completedAt` equal to `null`

**Date comparison:** Parse `startYear`, `startMonth`, `startDay` from the `<time>` element and compare as ISO date strings (`"2026-04-20" <= "2026-04-20"`). Tasks with no `<time>` element or with future dates are skipped. Filtering never splits or merges a group — a skipped node just doesn't run; the surviving group structure (which leaf preps in parallel, which chain is serial, the presentation sibling order) is unchanged.

**Scope:** the LLM Tasks phase only processes the canonical `LLM Tasks:` container at `Personal > 🔄 Review > 🔄 Daily Review > LLM Tasks:`. Scattered `#llm-task` items inside other review sections (e.g. `🔄 Monthly Review`, `☀️ Low priority daily tasks`) are handled by the Recurring Review phase (`/gtd:review:daily:due`), which has its own `#llm-task` subsection. If a user tags something `#llm-task` with a date outside both the canonical container and the review tree, it will not be surfaced automatically — they should move it into `LLM Tasks:`.

### Present and skip-gate

List ALL due-and-incomplete LLM tasks up front in a single message before any execution, grouped under their `⚙️ Prep` / `🙋 Presentation` headings so the user sees what will run in parallel and the order they'll be asked to confirm:

- For each task, show the task name (strip HTML tags for display, render `<a href>` as markdown links)
- Show child instruction nodes indented below, recursively (but not the `🔑 Key` / `🤖 Auto` marker children — surface those as a `key: <slug>` / `auto` annotation instead)
- Show the Workflowy URL: `https://workflowy.com/#/<shortId>`
- Mark mandatory tasks as **"always runs"** — these are not user-skippable because downstream tasks depend on them. The `📥 Import` barrier already ran; show it as done. `🤖 Auto` tasks run non-interactively and are also not skippable in the presentation walk.

After presenting the summary, gate the run with a single yes/no AskUserQuestion:

- Question: `Skip any LLM tasks?`
- Options: `No — run everything (Recommended)` first, then `Yes — let me pick what to skip`
- `multiSelect: false`
- Default expectation is `No`; if the user picks `No` (or "Other" with equivalent intent), execute the full DAG without further prompting

If the user picks `Yes`, issue a follow-up AskUserQuestion to choose which skippable tasks to skip:

- Use `multiSelect: true`
- One option per skippable task (label: short task name); plus "Other" added automatically by the tool
- AskUserQuestion allows at most 4 options per question. If there are more than 4 skippable tasks, split them across multiple questions within the same AskUserQuestion call (it accepts up to 4 questions)
- Mandatory tasks (the `📥 Import` barrier, which already ran) must not appear as options
- A skipped **prep** task and its `🔑 Key`-linked **presentation** task are skipped together. Skipping a head-of-chain task does not skip the rest of its `🔗 … serial chain` — only the selected node.
- Tasks the user selects are skipped; everything else runs

**Skip-the-prompt edge cases:**

- Zero due LLM tasks: skip the confirmation entirely, no prompt, move on to the Relink Orphaned Children phase
- No skippable tasks (only mandatory ones due): skip the yes/no prompt and run everything

### Execute the DAG

Once the skip-gate resolves, hand the surviving (un-skipped) tasks to the DAG executor: follow the **Execution Algorithm** (steps 0b–0f; 0a already ran) in `${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md` — read-groups, single metadata-sync, background prep fan-out, streaming confirmation walk, drain + summarize — using the staging contract and shared apply routine in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. That skill owns the prep subagent contract, the ≤5 concurrency cap, the serial-chain rule, and the drain-before-fan-out safeguard; this command only feeds it the skip-gate result.

The handoff must preserve the DAG skill's hybrid timing: after launching prep subagents/controllers in the background, begin the `🙋 Presentation` walk immediately. Do **not** wait for every prep branch to finish before asking the first confirmation question. The walk blocks only at the current presentation item until that item's own staged proposal is ready; slower later siblings such as the calendar chain or refine-inbox must not hold earlier ready items hostage.

Two project-specific bindings the executor needs:

- Date advancement (interval mapping, `<time>` format, background dispatch / drain) is in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md` — see [Updating dates](#updating-dates-after-each-apply).
- The 0f summary folds in the `🤖 Auto` briefing fragments — see [Summary](#summary).

Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) anywhere in the LLM Tasks phase.

### Executing instructions

Each task node's instruction is its **prep** or **apply** command, linked to its presentation sibling by `🔑 Key`. Interpret a node's instruction children:

- Skill / command invocation (e.g. `/gtd:refine-journal-prep`) → invoke it with the rest of the text as arguments
- `<code>command</code>` → run the command in bash
- Plain text → follow the instructions as described
- Nested children → treat as sub-instructions or details for the parent instruction (the `🔑 Key` and `🤖 Auto` children are markers, not instructions)

A node's instruction is a prep **or** an apply command, never run together inline: the prep command fans out in a subagent during 0d and the `🔑 Key`-linked apply command runs on the main thread during 0e (see `dag-llm-tasks.md`). The lone exception is a task that degrades to `needs-interactive`, which runs its full logic inline at its presentation slot.

### Handling failures

Never silently skip a task or quietly leave its date unchanged because something failed. If a task cannot complete — especially an MCP server failing to connect, a network error, an auth failure, or a tool returning errors — **stop and ask the user before moving on**.

- After a retry or two, if the failure persists, issue an `AskUserQuestion` describing what failed and the error
- Offer the user the chance to fix it together first (e.g. reconnect the MCP, re-auth, fix network) — do not treat skipping as the default
- Only skip the task if the user explicitly confirms it is okay to skip
- If the user chooses to skip, say so plainly and leave the task's date unchanged so it retries next run — but only after that explicit confirmation
- A prep subagent that fails stages `status: "error"`; the walk surfaces that error at the task's presentation slot and offers to run inline (it does **not** silently advance the date)

Do not proceed to the next task on a hidden assumption that skipping is fine.

### Updating dates after each apply

A task's date advances **only when its apply step completes** (or its `🤖 Auto` work finishes), never during prep — so an aborted prep run never skips a day. Update the date using the interval mapping, `<time>` format, and CLI commands in `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`, dispatching each `node update` / `node create` date write as a **background** Bash job (`run_in_background: true`) per the "Background Dispatch, Verify, and Drain" protocol there. Track each dispatched job, reap finished jobs every ~5 tasks, and surface any failures inline with the task name.

**CRITICAL — drain before any cache reimport.** The `📥 Import` barrier's `cache import-api` overwrites local SQLite from the API (write-through model), so a not-yet-landed background date-write fed stale data to the prep fan-out would make already-handled tasks reappear as due. The full ordering rule (drain the import _and_ all pending date-writes before fan-out, and again before the Relink Orphaned Children phase) is the "Drain before fan-out" safeguard in `${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md`.

### Summary

After the confirmation walk, drain all remaining background date-writes (wait for outstanding jobs, surface any failures), then show a brief summary that folds in the `🤖 Auto` briefing fragments from `.llm/gtd/review/briefings/`:

```text
🤖 LLM Tasks: 3 applied, 1 skipped, 0 remaining
  ✓ 3 dates advanced
  🎂 Jane Doe turns 40 on Fri — card mailed, gift TBD
```

## Phase 1: Relink Orphaned Children

Invoke `/gtd:review:daily:relink` — move any children that have accumulated on the GTD bucket navigation links under `Metadata` onto the real nodes their links point to. Mechanical and automatic (no prompts); runs here so it operates on the freshly-imported cache. Report its summary.

## Phase 2: Meeting Follow-up Review

Invoke `/gtd:review:daily:meetings` to walk meetings ingested since last review, flag probable follow-ups (especially from direct manager), and drop confirmed items into Inbox.

## Phase 3: Morning Overview

Invoke `/gtd:review:daily:overview` — morning orientation (calendar, reminders, next actions, inbox)

## Phase 4: Recurring Review

After overview completes, invoke `/gtd:review:daily:due` — walk through overdue recurring review items.

**Note:** LLM tasks already processed in the LLM Tasks phase will have updated dates and won't appear as overdue in the Recurring Review phase.

## Phase 5: File Loose Tasks

Invoke `/gtd:review:daily:file-tasks` — normalize the Next-Actions trees, then sweep loose tasks under both roots (Work and Personal) into the `⏰ Tasks (due dates)` / `📌 Tasks (asap)` buckets, categorizing within asap. Proposes a destination per task and walks them one at a time for confirmation. Relink (Phase 1) already ran, so strays are on the real roots; silent-skip when no loose tasks remain.
