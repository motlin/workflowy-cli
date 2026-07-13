---
name: meta-feedback-prep
description: Prep half of daily-review meta-feedback — scan recent daily-review transcripts for user corrections and preferences, reconcile against what's already implemented, and stage skill-improvement proposals to .llm/gtd/review/proposals/meta-feedback.json. Autonomous only; mutates no nodes and does not advance the watermark.
---

# Meta-Feedback — Prep

Mine the recent daily-review transcripts for feedback the user gave mid-review — corrections, preferences, "always/never" rules, time-wasters, "this should be a script", "these could run in parallel" — and **stage** the ones worth folding back into the skills. This is the autonomous, parallel-safe half; the apply half (`meta-feedback-apply`) files accepted improvements as tasks.

The whole point is that almost every daily review produces feedback that ought to change the skills themselves, and that feedback otherwise evaporates. Carry the full mining + reconciliation logic here; the apply command is thin. Stage to `.llm/gtd/review/proposals/meta-feedback.json` per `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` (the on-disk schema). Then stop.

## Prep contract (read this first)

This command runs inside a Phase 0 prep subagent (`${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md`). Obey the prep contract strictly:

- **Autonomous only.** Never call `AskUserQuestion` / `TaskCreate` / `TaskUpdate` / `TodoWrite`. Every judgment is staged as a proposal, never resolved interactively here.
- **No mutation.** Make **zero** `node update` / `node create` calls and do **not** write to `.llm/todo.md`. The only output is the staged JSON file under `.llm/gtd/review/`.
- **No watermark advance.** Do **not** move the `daily-review-meta-feedback` Scanner-State. That happens only in `meta-feedback-apply`, so an aborted prep never skips a window of transcripts.
- **`--dry-run`** is a no-op that still stages the `.json` (prep makes no writes regardless).

## Load the watermark

State lives under `Metadata > ⚙️ Scanner State > daily-review-meta-feedback` as a single child whose name is a JSON line (same pattern as `meeting-followup-reviewer`, see `${CLAUDE_PLUGIN_ROOT}/skills/otter-deduplication.md`):

```bash
./bin/run.js node search --query "daily-review-meta-feedback" --limit 1 --json
# then read its child:
./bin/run.js node get --id <node-id> --depth 1 --json --fields name,shortId,children
```

The child name looks like `{"last_reviewed_iso":"2026-06-25T18:00:00-07:00"}`. Parse `last_reviewed_iso` as the since-watermark. If the node is absent, default the watermark to 2 days ago (so the first run has something to chew on without trawling the whole history).

## Scan the transcripts

Run the scanner — it does the heavy JSONL filtering and emits a compact extract (human-typed turns plus the assistant action each reacted to), keeping the giant transcripts out of this subagent's context:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-review-feedback.mjs --since "<last_reviewed_iso>" > .llm/gtd/review/meta-feedback-scan.json
```

`meta-feedback-scan.json` is `[{sessionId, file, startTs, turns: [{ts, text, prevAssistant}]}]`, covering only sessions that ran `/gtd:review:daily` since the watermark. Read it from disk; do not re-parse the raw `.jsonl`.

## Classify the feedback

Read every turn and keep only the ones that imply a **durable change to a skill, command, or script** (not one-off task content). Sort each kept item into one of:

- **Correction / preference** — "don't do X", "always/never Y", "instead", "you didn't", "next time", redoing the assistant's work. The richest source.
- **Repeated decision** — a choice the user makes the same way across days (e.g. always "run everything", always "walk one-by-one"). Candidate to make the default or stop asking.
- **Time-waster** — the assistant fumbled, retried, did redundant work, or the user expressed impatience.
- **LLM→script** — work the model did by hand that a script should do (date math, parsing, formatting).
- **Parallelization / front-loading** — independent steps that ran sequentially, or prep that could move up front.

Drop pure task content ("buy milk"), pure data fixes, and anything that is about a single node rather than the workflow.

## Reconcile before proposing (the step that makes this useful)

A proposal is only worth surfacing if it is **not already handled**. For each candidate, check and discard it if any holds — this is exactly the filter that keeps the loop from re-nagging the same things every day:

- **Already implemented.** Grep the current skills/commands/scripts and recent history:

    ```bash
    grep -rin "<key phrase>" ${CLAUDE_PLUGIN_ROOT}/commands ${CLAUDE_PLUGIN_ROOT}/skills ${CLAUDE_PLUGIN_ROOT}/scripts
    git -C "$(git rev-parse --show-toplevel)" log --oneline -n 40 -- plugins/gtd
    ```

    If the behavior the user asked for is already in the docs/code (or a recent commit added it), drop it.

- **Already filed.** Grep `.llm/todo.md` for an open task covering it; if present, drop it.
- **Already declined.** Read `.llm/gtd/review/meta-feedback-declined.json` (array of `{fingerprint, summary, declinedAt}`); if a matching `fingerprint` is there, drop it.
- **Contradicts a deliberate, committed rule.** If the feedback asks to undo something the docs explicitly chose (e.g. "never batch the recurring walk" is intentional — see `due.md`), do **not** propose reverting it; at most stage it as a low-confidence note that flags the tension.

Compute a stable `fingerprint` per surviving candidate (a slug of the theme + target file) so the apply half can record declines against it.

## Stage the proposals

Write `.llm/gtd/review/proposals/meta-feedback.json` per the schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Create the directory first:

```bash
mkdir -p .llm/gtd/review/proposals
```

For each surviving candidate, emit one proposal:

- `header` — short theme label (e.g. `"Stop asking: walk one-by-one"`).
- `before` — the current behavior, **with the verbatim user quote and its date** so the apply walk shows the user their own words.
- `after` — the concrete proposed change, naming the target file(s) (e.g. "in `due.md`, drop the scope meta-question and go straight to item 1").
- `changes[]` — one `{type, icon, detail}`; use `type` = the classification bucket above (`correction` / `repeated` / `time-waster` / `llm-to-script` / `parallelization`) and a fitting icon.
- `fingerprint` — the stable slug computed above.
- `applyOps[]` — the **exact** command that files this as a task in `.llm/todo.md`, run verbatim on Accept. Append a `- [ ]` task with indented context lines, single-quoting each line (apostrophes via `'"'"'`):

    ```bash
    printf '%s\n' \
      '- [ ] <one-line improvement title>' \
      '  <what to change, naming the target skill/command/script file>' \
      '  Source (daily review <YYYY-MM-DD>): "<verbatim user quote>"' \
      '' >> .llm/todo.md
    ```

Set top-level fields: `task` = `"meta-feedback"` (inferred from the prep command and matches the filename); `generatedAt` = ISO-8601 with offset; `presentation` = `"Daily review meta-feedback"`; `summary` = `{sessionsScanned, turnsConsidered, candidates, proposalsStaged, droppedAlreadyDone, droppedDeclined}`. Set `status`: `"ready"` if any proposals; `"empty"` if nothing survived reconciliation (idempotent re-run); `"error"` if the scan failed.

Do **not** mutate any node, write `.llm/todo.md`, or advance the watermark. Return a one-line summary (sessions scanned, proposals staged, dropped-as-already-done count) and stop.

## Wiring into the daily review (one-time setup)

For the daily review to run this automatically, the task must exist as a node in the Phase 0 DAG container (`Personal > 🔄 Review > 🔄 Daily Review > LLM Tasks:`), per `${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md`. Add, via `./bin/run.js node create`:

- under `Prep`, a dated `Daily review meta-feedback` task with a `/gtd:meta-feedback-prep` child;
- under `Presentation`, an undated `Daily review meta-feedback` task with a `/gtd:meta-feedback-apply` child, placed last.

It has no shared-subtree writers, so it fans out as an independent parallel prep leaf — it only reads transcripts and stages a file. This is a live Workflowy change, so make it deliberately (not from inside a prep subagent).
