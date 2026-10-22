---
name: workout-guess-apply
description: 'Confirm the staged workout guesses one day at a time, create each confirmed entry under its Personal > 📅 Calendar day node, record days with no workout, and return a verified result to the daily-review scheduler.'
---

# Workout Guess — Apply

The interactive half of the workout guess. It reads what `/gtd:workout-guess-prep` staged and asks the user what they actually did on each unlogged day. No prediction logic lives here.

## Prerequisite

Run `/gtd:workout-guess-prep` first. It stages `.llm/gtd/review/proposals/workout-guess.json` and validates it.

## Do not use the built-in task list

Track progress inline. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`).

## Read the staged file

Follow **Read the staged proposal** in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md` for slug `workout-guess`:

- `empty` → return empty without prompting.
- `error` → surface the error and return failure.
- `needs-interactive` → run `/gtd:workout-guess-prep` inline, then continue from its fresh file.
- `ready` → present the proposals below.

## Present each day

Present `proposals[]` oldest first, in batches of up to 4 `AskUserQuestion` questions, one per day, with `header` as the question header. Each question shows the full date, the full guessed `after` line, and the `changes[]` detail (why it was guessed). Options:

- **Accept** — the user did this workout that day. Run the proposal's `applyOps` verbatim.
- **No workout that day** — make no Workflowy change. Append the proposal's `date` to the rest-days ledger (below) so the day is not guessed again.
- **Other** (auto-added) — the user types the workout they did. Normalize the typed text to the canonical line in `.llm/gtd/exercise-formats.md` (same rules as `/gtd:refine-exercise-prep`), then build the create op yourself as described in Build an op for typed text.

An `ambiguity` proposal has no guess: use `ambiguity.prompt` as the question and offer **No workout that day** plus Other. Never skip it.

Answers are facts about each date, so later answers in a batch stay valid even when an earlier one deviates. But later guesses not yet presented were chained on the deviating guess: when any answer is not Accept and proposals remain unpresented, re-run the prep export and guesser (with the ledger just updated) and present the refreshed proposals for the remaining dates instead.

### Build an op for typed text

Never hand-type a `<time>` element; use the staged `timeElement`. Escape apostrophes with `'"'"'` inside single quotes.

- `dayNode: "existing"`: `./bin/run.js node create --parent-id <nodeId> --name '<typed text>' --position bottom`
- `dayNode: "create"`: `./bin/run.js node create --parent-id <nodeId> --json '{"name":"<timeElement>","children":[{"name":"<typed text>"}]}' --position bottom`, built with `jq -nc --arg day "$TIME_EL" --arg entry "$TEXT" '{name: $day, children: [{name: $entry}]}'` so the JSON is escaped correctly.

### Guard against a day node created since prep

Before running a `dayNode: "create"` op, check whether that date's day node now exists (an earlier accepted proposal, another task, or the user may have created it):

```bash
./bin/run.js node get --path "Personal,📅 Calendar" --depth 1 --json --fields id,name,children \
  | jq -r --arg label '<date label, e.g. Thu, Oct 22, 2026>' \
    '.children[] | select((.name | ascii_downcase) | contains(">" + ($label | ascii_downcase) + "</time>")) | .id'
```

Match on the label, not the whole element: older day nodes carry lowercase `startyear` attributes.

If it exists, create the entry under that id with `--name` instead, so the day is never split across two nodes.

## Verify by read-back

After each create, read the day node back and confirm a child with exactly the created name exists:

```bash
./bin/run.js node get --id <day-node-id> --depth 1 --json --fields id,name,children \
  | jq -e --arg name '<created text>' '[.children[]? | select(.name == $name)] | length == 1'
```

For a `--json` create, find the new day node by its `<time>` element as in the guard above, then check its child. A failed read-back is a failure: report it and stop without returning success.

## Rest-days ledger

`.llm/gtd/review/workout-guess-rest-days.json` is a JSON array of `YYYY-MM-DD` dates the user said had no workout; prep passes it to the guesser. Create it as `[]` when missing, append the date, keep it sorted and unique:

```bash
LEDGER=.llm/gtd/review/workout-guess-rest-days.json
[ -f "$LEDGER" ] || echo '[]' > "$LEDGER"
jq --arg d '<date>' '. + [$d] | unique' "$LEDGER" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER"
```

## Return the result

Return success after the last verified answer, or empty when nothing was staged. Do not advance this task's date; the DAG executor runs the planned date operation.

## Summary

Report one line per day: created entry, no workout, or typed workout, plus `summary.remainingDays` when the cap or an ambiguity left days for the next run.
