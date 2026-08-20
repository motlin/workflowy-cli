---
description: Shared reference for advancing a review item's due date when it's marked done. Use in any daily/weekly/periodic review that rolls dates forward — the section→interval mapping, the native <time> element format (generated with `date`, never hand-typed), the node update/create CLI commands, and the background-dispatch / verify / drain protocol (including draining before any cache reimport).
globs: ${CLAUDE_PLUGIN_ROOT}/commands/review/**
---

# Review Date Updates

## Keyed DAG intervals

Phase 0 tasks take cadence from an optional `Interval: <amount><unit>` child on the prep node; the default is `1d`. Presentation nodes inherit the prep schedule and carry no date or interval. `${CLAUDE_PLUGIN_ROOT}/scripts/compute-llm-dag.mjs` validates the pair and writes the exact next-date operation to `.llm/gtd/review/phase0-plan.json`.

The DAG executor runs that operation only after verified success or an empty result. Task commands never update their own Phase 0 schedule.

## Recurring-review section intervals

The executable source of truth for this table is `${CLAUDE_PLUGIN_ROOT}/scripts/compute-overdue.mjs`, which the Recurring Review (`due.md`) runs to compute overdue items and stage each one's `node update`. Keep the two in sync when adding a section. The table below mirrors it for reference.

Each section name determines the interval used when advancing an item's date:

| Section name pattern | Interval              |
| -------------------- | --------------------- |
| Daily Review         | +1 day                |
| Frequently Important | +1 day                |
| Low priority daily   | +1 day                |
| Do goals for today   | +1 day                |
| Weekly Review        | +7 days               |
| Monthly Review       | +1 calendar month     |
| Every 2 months       | +2 calendar months    |
| Every 6 months       | +6 calendar months    |
| Annual Review        | +1 year               |
| Every few years      | Ask user for interval |

Match by substring in the section name. If a section doesn't match any pattern, ask the user for the interval.

This table is also a ladder, ordered shortest interval to longest. Making a repeatedly skipped item less frequent means moving it to the next row down and dating it by that row's interval — `compute-overdue.mjs` stages that move on every row as `lengthen`. `Every few years` is never an automatic target because it has no interval to compute a date from.

## `<time>` Element Format

```html
<time
	startYear="2026"
	startMonth="2"
	startDay="9"
	>Mon, Feb 9, 2026</time
>
```

- Use today + interval, not the example date.
- Do not zero-pad `startMonth`/`startDay`.
- Include a trailing space after `</time>`.

### Generate the element with `date` — never hand-type the weekday

**CRITICAL:** Writing a `<time>` element via the CLI stores it verbatim — the CLI/API does **not** compute the weekday from the date (bracket `[YYYY-MM-DD]` only converts via the Workflowy UI "Update" migration, not on API write). If you type the `Weekday, Mon D, YYYY` label by hand, the model regularly picks the wrong weekday (e.g. "Wed, Jun 11" for a Thursday). Always compute the element with the `date` command and paste its output verbatim.

```bash
# Target date = today + interval. Pick the -v flag for the section's interval:
#   +1 day → -v+1d   |   +7 days → -v+7d   |   +1 month → -v+1m
#   +2 months → -v+2m   |   +6 months → -v+6m   |   +1 year → -v+1y
ISO=$(date -v+1d +%Y-%m-%d)

# Build the <time> element (weekday computed by `date`, trailing space included):
TIME_EL=$(printf '<time startYear="%s" startMonth="%s" startDay="%s">%s</time> ' \
  "$(date -j -f %Y-%m-%d "$ISO" +%Y)" \
  "$(date -j -f %Y-%m-%d "$ISO" +%-m)" \
  "$(date -j -f %Y-%m-%d "$ISO" +%-d)" \
  "$(date -j -f %Y-%m-%d "$ISO" '+%a, %b %-d, %Y')")
# Then interpolate "$TIME_EL" into the node name passed to node update/create.
```

For a calendar-month interval (`+1m`/`+2m`/`+6m`) that would overflow a short month (e.g. Jan 31 + 1 month), `date` clamps forward into the next month — sanity-check the result and adjust to the intended month-end if needed.

## Updating Dates

On "done": set the item's `<time>` child to today + the section's interval. Create the child if missing. On "skip": no change.

### Update existing date child

```bash
./bin/run.js node update --id <date-child-id> --name '<time startYear="2026" startMonth="3" startDay="19">Thu, Mar 19, 2026</time> '
```

### Create date child if missing

```bash
./bin/run.js node create --parent-id <item-id> --name '<time startYear="2026" startMonth="3" startDay="19">Thu, Mar 19, 2026</time> ' --position bottom
```

### Confirm inline

After updating, confirm before moving to the next item:

```text
  ✓ Next due → Thu, Mar 19, 2026
```

## Background Dispatch, Verify, and Drain

The date `update`/`create` does not need to block the interactive loop. The interaction stays serial (one `AskUserQuestion` per item), but the write runs in the background so the next item appears immediately. Use this protocol wherever a review advances dates on "done".

### Dispatch

On "done", run the same `node update` / `node create` command via Bash with `run_in_background: true`. Do not wait for it. Record, per dispatched job:

- the background shell/job id
- the item name
- the intended new date

Then present the next item immediately and show the inline confirmation optimistically:

```text
  ✓ Next due → Thu, Mar 19, 2026
```

A freeform-note `node create` (when an item captures a note) is dispatched the same way, as a separate background job independent of the date write.

### Verify cadence

After every ~5 items, reap the finished background jobs with `BashOutput`:

- A clean job exits 0.
- The CLI signals failure with a non-zero exit (`this.error` in `packages/cli/src/commands/base-completion-command.ts`).

On any failure, surface it inline with the item name so the user can re-handle it. Never silently advance past a failed write.

### Drain before finishing

Before the review concludes, wait for all outstanding background jobs to finish and print a one-line summary:

```text
  ✓ 12 dates advanced
```

If any failed, list them with their item names instead of reporting success.

### Concurrency

Per-item reaping (the ~5-item cadence above) bounds the number of in-flight jobs, which keeps the count of spawned Node processes reasonable. The API client already retries on HTTP 429 (`packages/shared/src/api/workflowy-client.ts`), so a small burst of concurrent writes is safe. Keep the ~5 cadence to avoid spawning excessive processes.

### CRITICAL — drain before any cache reimport

Any step that runs `cache import-api` / `just daily` overwrites local SQLite from the API (write-through model). Drain all pending background date-writes before running such a step — otherwise the import clobbers items whose API write has not yet landed, and already-handled items reappear as overdue. This protects the "re-fetch after import" rule (`due.md:19`).
