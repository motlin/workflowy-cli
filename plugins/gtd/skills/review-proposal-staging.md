---
description: The prep→apply staging contract for the daily review's Phase 0. Use when writing a *-prep command that stages proposals or a *-apply command that consumes them — the .llm/gtd/review/ directory layout, the proposal and briefing JSON schemas, and the shared "read staged proposals → batch-present via AskUserQuestion → apply accepted applyOps verbatim → advance date" routine. Read it before adding or changing any review prep/apply pair.
globs: ${CLAUDE_PLUGIN_ROOT}/commands/**
---

# Review Proposal Staging

The daily review's Phase 0 DAG (`${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md`) splits each interactive task into an autonomous **prep** half that fans out in parallel and an interactive **apply** half walked in fixed presentation order. The two halves never share memory — prep runs in a subagent, apply runs on the main thread later. They communicate **only through staged files on disk**. This skill is the on-disk contract: the directory layout, the schemas, and the shared apply routine. It is referenced by `dag-llm-tasks.md`, `commands/review/daily.md`, and the `refine-journal` / `refine-exercise` prep/apply commands.

The pattern mirrors the existing journal/capture staging pipeline (`${CLAUDE_PLUGIN_ROOT}/commands/journal.md`, `${CLAUDE_PLUGIN_ROOT}/commands/capture.md`): scanners stage JSON, a central step confirms, an executor applies. The difference here is that **the proposal carries the exact CLI ops to run on Accept**, so the walk applies accepted items verbatim without re-deriving them.

## Directory Layout

```text
.llm/gtd/review/
  proposals/<key>.json     # one per prep-staged interactive task (has a 🙋 Presentation entry)
  briefings/<key>.json     # one per 🤖 Auto task (no presentation entry; briefing line only)
```

- `<key>` is the `🔑 Key: <slug>` shared by a task's prep node and its presentation node (`refine-journal`, `exercise`, `email-calendar`, `process-inbox`). It is the sole link between the prep that wrote the file and the apply that reads it. `🤖 Auto` tasks (`birthdays`, `otter-journal`) stage a briefing under the same key instead of a paired proposal (see Briefing Schema).
- Prep that only stages JSON makes **no** Workflowy writes. `process-inbox` is the exception: its prep (refine-inbox) stages `🔍` suggestion nodes in Workflowy instead of a JSON file, but the key-linkage idea is identical.
- Create the directories before staging:

```bash
mkdir -p .llm/gtd/review/proposals .llm/gtd/review/briefings
```

## Proposal Schema

A prep command for an interactive task writes `.llm/gtd/review/proposals/<key>.json`:

```json
{
	"task": "refine-journal",
	"taskNodeId": "<full-uuid-of-the-prep-node>",
	"generatedAt": "2026-06-22T14:03:00-07:00",
	"status": "ready",
	"presentation": "Refine calendar journal",
	"summary": {
		"entriesReviewed": 31,
		"proposalsStaged": 12
	},
	"proposals": [
		{
			"nodeId": "<full-uuid-of-the-entry-node>",
			"header": "Feb 9",
			"before": "Ran 5k with Gary in the morning",
			"after": "🏃 Ran 5k with @FrankWilson in the morning #exercise",
			"changes": [
				{"type": "people", "icon": "👤", "detail": "Gary → @FrankWilson"},
				{"type": "hobby", "icon": "🎮", "detail": "running → #exercise"},
				{"type": "emoji", "icon": "😀", "detail": "add 🏃 prefix"}
			],
			"applyOps": [
				"./bin/run.js node update --id <full-uuid-of-the-entry-node> --name '🏃 Ran 5k with @FrankWilson in the morning #exercise'"
			]
		}
	]
}
```

### Top-level fields

| Field | Meaning |
| --- | --- |
| `task` | Task slug = the `🔑 Key`. Matches the filename. |
| `taskNodeId` | Full UUID of the task's prep node, so the walk can advance its date. |
| `generatedAt` | ISO-8601 timestamp with offset. Used for idempotency / staleness checks. |
| `status` | `ready` \| `needs-interactive` \| `empty` \| `error` (see below). |
| `presentation` | Human label the walk shows while presenting this task. |
| `summary` | Free-form object of counts the walk folds into the final summary. |
| `proposals` | Ordered array of per-item proposals (empty unless `status: "ready"`). |
| `scannerState` | Optional, top-level (not per-proposal). State a self-tracking scanner persists on apply (see Advance Scanner-State). |

### `status` values

| Status | Meaning | Walk behavior |
| --- | --- | --- |
| `ready` | Prep computed proposals; `proposals[]` is populated. | Present them (batched). |
| `needs-interactive` | Task has no separable autonomous phase (graceful degradation). | Run the task **inline** at its presentation slot, as a fully interactive task. |
| `empty` | Nothing to do (e.g. month already refined; idempotent re-run). | Skip silently; note in summary. |
| `error` | Prep failed. | Surface the error; offer to run inline. |

### Per-proposal fields

| Field | Meaning |
| --- | --- |
| `nodeId` | Full UUID of the Workflowy node this proposal mutates. Never a short id (short ids 404 on writes). |
| `header` | Short label for the `AskUserQuestion` header (e.g. the entry date `"Feb 9"`). |
| `before` | **Full** original text. Never truncated. |
| `after` | **Full** proposed text. Never truncated. |
| `changes` | Array of `{ type, icon, detail }` describing each change (see icon table). |
| `ambiguity` | Optional `{ prompt, options[] }` when prep could not decide. Replaces the standard Accept/Reject options for that item. |
| `applyOps` | Array of exact CLI command strings the walk runs **verbatim** on Accept, never re-deriving them. |

### Change icons

| Icon | Type        | Description                                   |
| ---- | ----------- | --------------------------------------------- |
| 👤   | `people`    | Name → @Name                                  |
| 🎮   | `hobby`     | Activity → #hobby-tag                         |
| 🏷️   | `category`  | Add category tag (e.g. #exercise)             |
| ✏️   | `typo`      | Spelling/grammar fix                          |
| 😀   | `emoji`     | Add emoji prefix                              |
| ⚠️   | `ambiguous` | Needs user input (carry an `ambiguity` block) |

### `applyOps` are authoritative

Prep stages the **exact** commands so the walk never re-computes a refinement (re-deriving in a different context risks divergence). Each op is a complete `node …` invocation with the full UUID and final text already escaped for the shell (entries with apostrophes use `'"'"'` escaping inside the single-quoted `--name`). Writes go through the CLI only — never edit SQLite directly. If a proposal has no `applyOps`, Accept is a no-op (used for confirm-only gates that the apply command handles specially) — **except** an emoji `ambiguity` proposal, where prep omits `applyOps` on purpose and the walk builds the `node update` from the chosen emoji (see Batch-present below).

## Briefing Schema (`🤖 Auto` tasks)

A `🤖 Auto` task (e.g. `birthdays`, `otter-journal`) does its **full** autonomous work — prep _and_ apply — during fan-out, then stages a briefing fragment instead of a confirmable proposal. It has no `🙋 Presentation` entry and never prompts. Write `.llm/gtd/review/briefings/<key>.json`:

```json
{
	"task": "birthdays",
	"status": "ready",
	"lines": ["🎂 Jane Doe turns 40 on Fri — card mailed, gift TBD", "🎂 No other birthdays in the next 14 days"],
	"autoApplied": ["Created 'Mail birthday card for Jane Doe' under Next Actions"]
}
```

| Field         | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `task`        | Task slug = the `🔑 Key`.                                           |
| `status`      | `ready` \| `empty` \| `error`.                                      |
| `lines`       | Briefing lines folded verbatim into the final summary.              |
| `autoApplied` | Actions the task already performed autonomously (for transparency). |

## Shared Apply Routine

Every `*-apply` command (`refine-journal-apply`, `refine-exercise-apply`, `email-calendar` apply, …) runs the **same** shape. Factor it here; the apply commands stay thin and only describe their task-specific presentation wording.

### Read the staged proposal

Read `.llm/gtd/review/proposals/<key>.json` for the command's key. Branch on `status`:

- `empty` → report "nothing to apply" and advance the date (the prep ran and found no work; treat as a clean no-op for the day).
- `needs-interactive` or `error` → run the task's interactive logic **inline** (graceful degradation), then advance the date as that logic normally would.
- `ready` → continue with the batch-present loop below.

### Batch-present via AskUserQuestion

Present `proposals[]` in **batches of up to 4** using `AskUserQuestion` — one question per proposal. Never truncate `before`/`after`.

For each proposal, the question text includes the full `before`, the full `after`, and the `changes[]` rendered as `<icon> <detail>` lines. Use `header` for the question header.

Options per proposal:

- **Accept** — run this proposal's `applyOps` verbatim.
- **Reject** — skip; make no changes.
- **Accept with note** — accept but the user types a modification; apply the user's edited text instead of the staged `after`.

If a proposal carries an `ambiguity` block, use its `prompt` as the question and its `options` as the choices **instead of** Accept/Reject. The chosen option determines the final text. Two cases:

- **People (or similar) ambiguity** — the `options` are the candidate resolutions (e.g. `@FrankWilson` / `@EvanMiller` / `Skip`). Each option carries its own `applyOps`, so the chosen option's ops run verbatim (and `Skip` makes no change).
- **Emoji picker** — when the ⚠️ proposal is an emoji proposal (`changes[]` is emoji-only / the entry merely lacks a leading emoji), present `ambiguity.options` as the **4 contextual emoji choices**; `AskUserQuestion` auto-adds "Other" so the user can type a custom emoji. Prep omits `applyOps` for these because the final text depends on the choice (per the no-`applyOps` allowance above), so the walk **prepends** the chosen emoji (or the "Other" free-text) to `before` and builds the command itself:

    ```bash
    ./bin/run.js node update --id <full-uuid> --name '<chosen-emoji> <capitalized-before>'
    ```

    Before building the command, apply `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md` to the visible text after the emoji: capitalize the first word (`🚗 Drove home`, not `🚗 drove home`) and clear proper nouns/initialisms (`New York`, `PDF`) while leaving ordinary mid-sentence verbs alone. Escape any apostrophes in the final text with `'"'"'` inside the single-quoted `--name`.

### Apply accepted ops

After each batch's answers, immediately run the `applyOps` for every Accepted proposal **verbatim** (or the user's edited command for "Accept with note"). Then present the next batch. Applying per-batch (not at the end) keeps the work incremental and crash-safe.

### Advance Scanner-State

If the staged file carries a top-level `scannerState` object, persist it to the task's state node `Metadata > ⚙️ Scanner State > <task>` **after** the accepted ops have been applied — a scanner cursor advances only once the entries it covers exist, so a run that creates nothing (everything rejected, or `status: "empty"`) leaves the state untouched and the work resurfaces next run. Read the JSON child's full UUID (writes 404 on short ids), then overwrite it with the staged state as **compact single-line JSON**: Workflowy treats a newline in `--name` as a node boundary, so a multi-line write shatters the state into sibling children.

```bash
CHILD_ID=$(./bin/run.js node get --path "Metadata,⚙️ Scanner State,<task>" --depth 1 --json --fields children \
  | jq -r '.children[0].id')
NEXT_STATE=$(jq -c '.scannerState' .llm/gtd/review/proposals/<key>.json)
./bin/run.js node update --id "$CHILD_ID" --name "$NEXT_STATE"
```

The `otter-journal-scanner` state (`{cursor, session_start, last_synced_otid, reached_beginning}`) is the shape this mechanism was modeled on — `last_synced_otid` is the cursor-based dedup boundary, `cursor` / `session_start` bound the in-progress scan window, and `reached_beginning` flags a fully back-filled history. Note that `otter-journal` itself no longer uses this staged-`scannerState`→apply path: as a `🤖 Auto` task it advances that cursor **directly** in the scanner's `create` mode. This generic Advance Scanner-State step remains for any interactive apply task that stages a top-level `scannerState`.

### Advance the task's date

After the last batch, advance the task node's review date by dispatching a **background** date-write per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md` (interval mapping + `<time>` format + drain protocol). Use `taskNodeId` from the staged file. Advancing only on apply — never in prep — means an aborted prep run never skips a day. Tasks that track their own progress advance that state on apply too, never in prep — generic `scannerState` blocks via the Advance Scanner-State step above, task-specific progress (e.g. refine-journal's Scanner-State node) in the apply command's own logic.

### Idempotency

A re-run after a completed apply reads `status: "empty"` (prep found nothing new) and skips without re-applying. Never apply the same `applyOps` twice.

## Verification

- **Schema shape-check:** `jq` each staged file against the fields above (`jq -e '.task and .status and (.proposals|type=="array")' .llm/gtd/review/proposals/<key>.json`).
- **Dry-run staging:** a prep `--dry-run` writes the `.json` but makes **zero** `node update`/`node create` calls — only `.llm/gtd/review/` is touched.
- **applyOps fidelity:** the walk runs `applyOps` verbatim; a stubbed-Accept walk over a fixture asserts the exact staged commands ran and the date-advance dispatched.
