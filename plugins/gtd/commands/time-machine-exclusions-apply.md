---
name: time-machine-exclusions-apply
description: Silently finish a clean check, or run and verify the backup-exclude sweep when prep found build directories missing the xattr.
---

# Time Machine Exclusions Apply

Read `.llm/gtd/review/proposals/time-machine-exclusions.json` and act on its status.

## Handle the staged status

- `empty`: report nothing and return success. The DAG executor advances the date without prompting.
- `error`: surface the error and return failure. Do not advance the date.
- `ready`: show every unmatched directory, run the staged sweep, then verify.

For `ready`, run the sweep from `/gtd:time-machine-exclusions-prep` (`tmutil addexclusion`, no `sudo`), then rerun that command's check. If any path still lacks the `com.apple.metadata:com_apple_backup_excludeItem` xattr, show the remaining paths and return failure; never advance on a partial sweep. On a clean recheck, return success.

The apply command never updates the task date. The Phase 0 executor owns the name-matched date operation.
