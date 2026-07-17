---
name: time-machine-exclusions-prep
description: Find project build directories missing the backup-exclude xattr that both Time Machine and Backblaze honor, and stage a silent-or-confirmable result for the daily review.
---

# Time Machine Exclusions Prep

Check build directories under `~/projects` without prompting or changing any exclusion state. This command runs as a Phase 0 prep task and stages `.llm/gtd/review/proposals/time-machine-exclusions.json`.

The target is the `com.apple.metadata:com_apple_backup_excludeItem` xattr. `tmutil addexclusion` sets it; `tmutil addexclusion -p` does not — it writes a fixed-path entry to Time Machine's plist instead. Time Machine honors both, but Backblaze's Time Machine honoring reads only the xattr, so `-p` exclusions leave Backblaze walking the directory (its filesystem scan is the expensive part, not the upload). Detect and fix by the xattr, never by `tmutil isexcluded` — that reports both kinds and hides the gap.

## Run the check

Find build directories and print only paths missing the xattr:

```bash
find "$HOME/projects" -type d \( -name node_modules -o -name target -o -name build -o -name dist \) -prune -print0 |
	while IFS= read -r -d '' directory; do
		xattr "$directory" 2>/dev/null | grep -q com_apple_backup_excludeItem || printf '%s\0' "$directory"
	done
```

Capture the null-delimited result without losing the command's exit status. A failed `find` or `xattr` call stages `status: "error"`; never reinterpret a failed check as an empty result.

## Stage the result

Create `.llm/gtd/review/proposals/` and write the proposal for the inferred slug `time-machine-exclusions`.

- No unmatched directories: stage `status: "empty"`, `summary.missingExclusions: 0`, and an empty `proposals` array.
- Unmatched directories: stage `status: "ready"`, include every path in `summary.directories`, and create one confirm-only proposal with empty `applyOps`.
- Check failure: stage `status: "error"` with the command error.

Use this sweep command in the ready proposal:

```bash
find "$HOME/projects" -type d \( -name node_modules -o -name target -o -name build -o -name dist \) -prune -print0 |
	xargs -0 -n40 tmutil addexclusion
```

`tmutil addexclusion` sets the xattr on user-owned paths without `sudo`, but prep stays detection-only: stage the proposal, return a one-line count, and stop. Apply runs the sweep.
