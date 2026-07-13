---
name: time-machine-exclusions-apply
description: Silently finish a clean Time Machine exclusion check or ask the user to run and verify the fixed-path sweep when prep found unmatched build directories.
---

# Time Machine Exclusions Apply

Read `.llm/gtd/review/proposals/time-machine-exclusions.json` and act on its status.

## Handle the staged status

- `empty`: report nothing and return success. The DAG executor advances the date without prompting.
- `error`: surface the error and return failure. Do not advance the date.
- `ready`: show every unmatched directory and the staged sweep command, then ask whether the user completed it.

On “not now” or skip, return skipped and leave the date unchanged. On confirmation, rerun the no-sudo check from `/gtd:time-machine-exclusions-prep` before returning success. If paths remain or verification fails, show the result and return failure; never advance based on confirmation alone.

The apply command never runs `sudo` and never updates the task date. The Phase 0 executor owns the key-linked date operation.
