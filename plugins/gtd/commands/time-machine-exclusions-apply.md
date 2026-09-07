---
name: time-machine-exclusions-apply
description: Silently finish a clean Time Machine exclusion check or ask the user to run and verify the fixed-path sweep when prep found unmatched build directories.
---

# Time Machine Exclusions Apply

Read `.llm/gtd/review/proposals/time-machine-exclusions.json` and act on its status.

## Handle the staged status

- `empty`: report nothing and return success. The DAG executor advances the date without prompting.
- `error`: surface the error and return failure. Do not advance the date.
- `ready`: show `summary.report` (each durable path, plus one aggregate line per repo for build dirs inside `.worktrees/`) and the staged sweep command, then ask whether the user completed it. Never expand the aggregate into individual worktree paths, and never suggest excluding or skipping a `.worktrees` root -- a worktree with uncommitted changes needs backing up.

On “not now” or skip, return skipped and leave the date unchanged. On confirmation, rerun the no-sudo check from `/gtd:time-machine-exclusions-prep` before returning success.

Verify against the **staged** `summary.directories` list, not the raw scan total. Build directories appear constantly on this machine (every new worktree adds `node_modules`), so a fresh scan almost always finds paths that did not exist when prep ran. Failing on those makes the task permanently unsatisfiable.

- Every staged path now excluded → success, even when the rescan lists new paths. Report the new ones as a count so the next run picks them up; a rescan that only finds worktree churn is still success.
- Any staged path still unexcluded, or the check itself errors → show the result and return failure; never advance based on confirmation alone.

The apply command never runs `sudo` and never updates the task date. The Phase 0 executor owns the name-matched date operation.
