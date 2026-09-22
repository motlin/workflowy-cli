---
name: refine-exercise-prep
description: 'Prep half of #exercise formatting — scan one month of #exercise journal entries, compute formatting-consistency fixes, and stage them to .llm/gtd/review/proposals/refine-exercise.json. Autonomous only; mutates no nodes and does not advance state.'
---

# Refine #exercise — Prep

Compute the next month's `#exercise` formatting fixes and **stage** them. This is the autonomous, parallel-safe half of the exercise-formatting split — the matching/compute work plus the formatting-consistency rules. It mirrors `refine-journal-prep` (which stages `refine-journal.json` for `refine-journal-apply`); here the apply half is `refine-exercise-apply`, which reads the staged file.

Carries the full formatting rules; the apply command is thin. Stage proposals to `.llm/gtd/review/proposals/refine-exercise.json` per `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` (the on-disk schema). Then stop.

## Why this runs after refine-journal

In the daily review DAG, this prep is the last task in `Serial: Calendar journal` (otter → refine-journal → exercise). It reformats the same entries `refine-journal` just tagged, so it must run after `refine-journal-prep`, never as a parallel sibling.

## Prep contract (read this first)

This command runs inside a Phase 0 prep subagent. Obey the prep contract strictly:

- **Autonomous only.** Never call `AskUserQuestion` / `TaskCreate` / `TaskUpdate` / `TodoWrite`. Ambiguities are staged (⚠️ + an `ambiguity` block), never resolved interactively here.
- **No node mutation.** Make **zero** `node update` / `node create` calls. The only output is the staged JSON file under `.llm/gtd/review/`.
- **No state advance.** Do not advance Scanner-State or the review date. Apply owns task-specific state; the DAG executor owns scheduling.
- **Read, don't rebuild, metadata.** The DAG runs `metadata-sync` once before fan-out. Read the cached `.llm/gtd/metadata/` files; never trigger a concurrent rebuild.
- **`--dry-run`** is the verification mode: compute and write the `.json`, but the assertion is that zero `node` writes happen — already true for prep. Honor it as a no-op that still stages.

## Pick the month

Mirror `refine-journal-prep`: refine the same month it just processed (this pass piggybacks on refine-journal's month so it re-formats entries that were just tagged). Read the refine-journal Scanner-State to learn which month is current, then scan that month's `#exercise` entries:

```bash
./bin/run.js node get --path "Metadata,⚙️ Scanner State,refine-journal" --depth 2
```

Use `current_month_in_progress` if set, otherwise the month immediately before `last_completed_month` (the one refine-journal-prep just computed in the same chain). Do not write any state back here.

> Run `./bin/run.js node get --help` to verify available flags before constructing commands.

## Load the personal format spec

Program names, hashtag casing, and canonical line shapes are personal, so they live in the gitignored `.llm/gtd/exercise-formats.md`, never in this plugin. Read it first:

```bash
cat .llm/gtd/exercise-formats.md
```

The spec lists each program the user logs, with its canonical hashtag casing, its canonical line shape, and any program-specific rules (such as whether Roman-numeral phases are allowed), plus defaults that apply to every listed program (prefix emoji, field separator, number style, name casing).

If the file is missing or lists no programs, there is nothing to normalize: stage `status: "empty"` with `summary.entriesReviewed: 0` and stop. Never invent a format.

## Load metadata (read cache)

The single `metadata-sync` has already run in the DAG, so this is a read-only step. The cached hobbies registry backs up the spec's casing when an entry spells a listed program loosely:

```bash
jq '[.children[] | .children[] | select(.name | length > 0) | {
  tag: (.name | gsub("<[^>]+>"; "") | gsub("^[^#]*"; "")),
  fullName: ([.children[]? | select(.name | startswith("Full name:"))]
    | .[0].name // null | if . then ltrimstr("Full name: ") else null end)
}]' .llm/gtd/metadata/hobbies-registry.json
```

The `tag` field gives the registry's casing for each program. When it disagrees with the spec, the spec wins.

## Fetch month entries

```bash
./bin/run.js node get --path "Personal,📅 Calendar,🗃️ Archive,2020 - 2029 decade,<year>,<month>" --depth 3
```

Consider only entries that are `#exercise` workouts for a program the spec lists — those tagged `#exercise` or carrying one of the spec's program hashtags (any casing). Skip everything else, including `#exercise` entries for programs the spec does not list.

## Formatting-consistency rules

For each matching entry, normalize it to its program's canonical line shape from the spec. Never alter the meaning, only the formatting. Apply the spec's defaults and the program's own rules, which typically cover:

- **Prefix emoji.** The leading emoji the spec names; add it if missing, replace a different leading emoji with it.
- **Program hashtag casing.** Match the program by name and fix the hashtag to the spec's casing.
- **Field separators.** Use the spec's separator between the program's structured fields (phase, week, day, workout, and so on).
- **Number style.** Digits or words, Roman numerals or not, exactly as the spec says for that program.
- **Name casing.** Workout and body-part names cased as the spec says.
- **No punctuation before the trailing tag.** Remove any period, comma, or other punctuation immediately before `#exercise` (or whichever trailing tag the spec names).
- **No trailing or double spaces.** Collapse any run of multiple spaces to one, and strip trailing whitespace.
- **Shared text rules.** Also apply `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md`.

Follow the spec over this list when they differ; the list only names the kinds of rule a spec carries.

If an entry is already in canonical form, it produces **no** proposal (so a re-run is idempotent and stages `status: "empty"` when the month is clean).

### Ambiguity

If you cannot confidently map an entry to a program the spec lists (so the hashtag casing or program name is uncertain), or the field structure is too irregular to normalize safely, stage a ⚠️ proposal with an `ambiguity` block (`prompt` + candidate `options`) rather than guessing. Let the user decide at apply time.

## Stage the proposals

Write `.llm/gtd/review/proposals/refine-exercise.json` exactly per the schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Create the directory first:

```bash
mkdir -p .llm/gtd/review/proposals
```

For each entry that needs formatting changes, emit one proposal with:

- `nodeId` — the entry's **full UUID** (never a short id; short ids 404 on writes).
- `header` — the entry date (e.g. `"Feb 9"`).
- `before` / `after` — the **full** original and normalized text, never truncated.
- `changes[]` — one `{ type, icon, detail }` per fix. Use `{"type": "format", "icon": "🏷️", "detail": "..."}` for formatting fixes (e.g. `"add 💪 prefix"`, `"#program → #Program"`, `"week 3 day 2 → week 3, day 2"`, `"Upper Body capitalized"`, `"removed period before #exercise"`).
- `ambiguity` — present only on ⚠️ proposals: `{ prompt, options[] }`.
- `applyOps[]` — the **exact** `./bin/run.js node update --id <full-uuid> --name '<final after text>' --expect-name '<full before text>'` command(s) the apply walk runs verbatim on Accept. The `--expect-name` guard is **mandatory** (see `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` → Stale-write guard): pass the proposal's full `before` so the CLI refuses the write if the entry changed since prep. Entries with apostrophes use `'"'"'` escaping inside **both** single-quoted values. Derive `before` from a fresh read of the live cache the barrier just imported, not a stale snapshot.

### Chain on staged refine-journal proposals

`refine-journal-prep` has already staged `.llm/gtd/review/proposals/refine-journal.json` from the same live text, and its walk runs before this one. When the user accepts a journal proposal, the entry's name becomes that proposal's `after`, so an op guarded by `--expect-name '<live text>'` would stale-skip and the entry would need a manual rebuild. For every `#exercise` entry whose `nodeId` also appears in `refine-journal.json` `proposals[]`, stage both outcomes:

- Top-level `before` / `after` / `applyOps` stay the **fallback**, keyed on the live text: `before` is the live name, `after` is the exercise fix of it, and the op carries `--expect-name '<live text>'`. Apply runs this when the journal proposal was rejected.
- A `chained` block holds the **chained** op, keyed on the journal text: `{ "task": "refine-journal", "before": <journal proposal's after>, "after": <exercise fix of that text>, "applyOps": ["./bin/run.js node update --id <full-uuid> --name '<chained after>' --expect-name '<journal after>'"] }`. Apply runs this when the journal proposal was accepted.

Compute the exercise fix independently on each text, so tags and @mentions the journal proposal adds survive into the chained `after`. Stage the proposal when either variant changes the text; if the chained text is already canonical, keep `chained` with `after` equal to `before` and empty `applyOps`, and apply drops it. If `refine-journal.json` is missing or not `ready`, no entry overlaps and no proposal gets a `chained` block.

After writing the file, check the chain against the journal staging. It exits non-zero when an overlapping entry lacks `chained`, when `chained.before` differs from the journal `after`, or when a chained name update lacks `--expect-name`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/chain-exercise-ops.mjs validate \
  .llm/gtd/review/proposals/refine-exercise.json .llm/gtd/review/proposals/refine-journal.json
```

Set top-level fields:

- `task`: `"refine-exercise"` (inferred from the prep command and matches the filename).
- `generatedAt`: ISO-8601 timestamp with offset.
- `status`: `"ready"` if any proposals; `"empty"` if every `#exercise` entry in the month is already canonical; `"error"` if prep failed.
- `presentation`: `"Refine #exercise"`.
- `summary`: `{ entriesReviewed, proposalsStaged }`.

Do **not** mutate any node and do **not** advance any state. Return a one-line summary of what was staged (month, exercise entries reviewed, proposals staged, status) and stop.
