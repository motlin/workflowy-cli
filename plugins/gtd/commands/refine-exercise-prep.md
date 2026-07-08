---
name: refine-exercise-prep
description: 'Prep half of #exercise formatting — scan one month of #exercise journal entries, compute formatting-consistency fixes, and stage them to .llm/gtd/review/proposals/refine-exercise.json. Autonomous only; mutates no nodes and does not advance state.'
---

# Refine #exercise — Prep

Compute the next month's `#exercise` formatting fixes and **stage** them. This is the autonomous, parallel-safe half of the exercise-formatting split — the matching/compute work plus the formatting-consistency rules. It mirrors `refine-journal-prep` (which stages `refine-journal.json` for `refine-journal-apply`); here the apply half is `refine-exercise-apply`, which reads the staged file.

Carries the full formatting rules; the apply command is thin. Stage proposals to `.llm/gtd/review/proposals/refine-exercise.json` per `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` (the on-disk schema). Then stop.

## Why this runs after refine-journal

In the daily review's Phase 0 DAG (`${CLAUDE_PLUGIN_ROOT}/skills/dag-llm-tasks.md`), this prep is the **last** link of the `🔗 Calendar journal — serial chain` (otter → refine-journal → exercise). It re-formats the **same** calendar-journal entries `refine-journal` just tagged, so it must run **after** `refine-journal-prep` returns — never as a parallel sibling. By the time this runs, the month's entries already carry their people/hobby/category/emoji tags; this pass only normalizes the **formatting** of the `#exercise` entries on top of that.

## Prep contract (read this first)

This command runs inside a Phase 0 prep subagent. Obey the prep contract strictly:

- **Autonomous only.** Never call `AskUserQuestion` / `TaskCreate` / `TaskUpdate` / `TodoWrite`. Ambiguities are staged (⚠️ + an `ambiguity` block), never resolved interactively here.
- **No node mutation.** Make **zero** `node update` / `node create` calls. The only output is the staged JSON file under `.llm/gtd/review/`.
- **No state advance.** Do **not** advance any Scanner-State or review date. That happens only in `refine-exercise-apply`, so an aborted prep never skips a month.
- **Read, don't rebuild, metadata.** The DAG runs `metadata-sync` once before fan-out. Read the cached `.llm/gtd/metadata/` files; never trigger a concurrent rebuild.
- **`--dry-run`** is the verification mode: compute and write the `.json`, but the assertion is that zero `node` writes happen — already true for prep. Honor it as a no-op that still stages.

## Pick the month

Mirror `refine-journal-prep`: refine the same month it just processed (this pass piggybacks on refine-journal's month so it re-formats entries that were just tagged). Read the refine-journal Scanner-State to learn which month is current, then scan that month's `#exercise` entries:

```bash
./bin/run.js node get --path "Metadata,⚙️ Scanner State,refine-journal" --depth 2
```

Use `current_month_in_progress` if set, otherwise the month immediately before `last_completed_month` (the one refine-journal-prep just computed in the same chain). Do not write any state back here.

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

## Load metadata (read cache)

The single `metadata-sync` has already run in the DAG, so this is a read-only step. Use the cached hobbies registry to get the canonical hashtag casing for each exercise program:

```bash
jq '[.children[] | .children[] | select(.name | length > 0) | {
  tag: (.name | gsub("<[^>]+>"; "") | gsub("^[^#]*"; "")),
  fullName: ([.children[]? | select(.name | startswith("Full name:"))]
    | .[0].name // null | if . then ltrimstr("Full name: ") else null end)
}]' .llm/gtd/metadata/hobbies-registry.json
```

The `tag` field gives the canonical casing (e.g. `#DigIn`, `#Insanity`) the entry's program hashtag must match.

## Fetch month entries

```bash
./bin/run.js node get --path "Personal,📅 Calendar,🗃️ Archive,2020 - 2029 decade,<year>,<month>" --depth 3
```

Consider only entries that are `#exercise` workouts — those tagged `#exercise` or carrying a recognized exercise-program hashtag from the registry. Skip everything else.

## Formatting-consistency rules

The canonical form of an `#exercise` entry is:

```text
💪 #ProgramName phase X, week Y, day Z, Workout Name N #exercise
```

For each `#exercise` entry, normalize it to that shape. Apply every rule below; never alter the meaning, only the formatting:

- **💪 prefix.** Every entry starts with `💪`. If it is missing, add it. If the entry already starts with a different emoji, replace it with `💪`.
- **Program hashtag casing.** The `#ProgramName` hashtag must match the canonical casing in the hobbies registry (e.g. `#digin` → `#DigIn`). Match the program by name and fix the casing.
- **Commas between fields.** Put a comma between the `week` and `day` fields (and the surrounding `phase` / workout fields), e.g. `week 3 day 2` → `week 3, day 2`. Use commas, not other separators, between these fields.
- **Numeric, not spelled-out.** Phase / week / day numbers are digits, never words (e.g. `week three` → `week 3`, `phase two` → `phase 2`). Roman numerals for phase are acceptable only if that is the program's own convention in the registry; otherwise normalize to digits.
- **Capitalize workout / body-part names.** Capitalize the workout name and any body-part names (e.g. `back and biceps` → `Back and Biceps`, `cardio` → `Cardio`).
- **No punctuation before `#exercise`.** Remove any trailing period, comma, or other punctuation immediately before the `#exercise` tag (e.g. `... day 2. #exercise` → `... day 2 #exercise`).
- **No trailing or double spaces.** Collapse any run of multiple spaces to one, and strip trailing whitespace.
- **Shared text rules.** Also apply `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md`.

If an entry is already in canonical form, it produces **no** proposal (so a re-run is idempotent and stages `status: "empty"` when the month is clean).

### Ambiguity

If you cannot confidently map an entry to a known program (so the hashtag casing or program name is uncertain), or the field structure is too irregular to normalize safely, stage a ⚠️ proposal with an `ambiguity` block (`prompt` + candidate `options`) rather than guessing. Let the user decide at apply time.

## Stage the proposals

Write `.llm/gtd/review/proposals/refine-exercise.json` exactly per the schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Create the directory first:

```bash
mkdir -p .llm/gtd/review/proposals
```

For each entry that needs formatting changes, emit one proposal with:

- `nodeId` — the entry's **full UUID** (never a short id; short ids 404 on writes).
- `header` — the entry date (e.g. `"Feb 9"`).
- `before` / `after` — the **full** original and normalized text, never truncated.
- `changes[]` — one `{ type, icon, detail }` per fix. Use `{"type": "format", "icon": "🏷️", "detail": "..."}` for formatting fixes (e.g. `"add 💪 prefix"`, `"#digin → #DigIn"`, `"week 3 day 2 → week 3, day 2"`, `"Back and Biceps capitalized"`, `"removed period before #exercise"`).
- `ambiguity` — present only on ⚠️ proposals: `{ prompt, options[] }`.
- `applyOps[]` — the **exact** `./bin/run.js node update --id <full-uuid> --name '<final after text>'` command(s) the apply walk runs verbatim on Accept. Entries with apostrophes use `'"'"'` escaping inside the single-quoted `--name`.

Set top-level fields:

- `task`: `"refine-exercise"` (matches the `🔑 Key` and the filename).
- `taskNodeId`: full UUID of the refine-exercise task node (so the apply walk can advance its review date).
- `generatedAt`: ISO-8601 timestamp with offset.
- `status`: `"ready"` if any proposals; `"empty"` if every `#exercise` entry in the month is already canonical; `"error"` if prep failed.
- `presentation`: `"Refine #exercise"`.
- `summary`: `{ entriesReviewed, proposalsStaged }`.

Do **not** mutate any node and do **not** advance any state. Return a one-line summary of what was staged (month, exercise entries reviewed, proposals staged, status) and stop.
