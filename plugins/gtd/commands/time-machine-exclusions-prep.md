---
name: time-machine-exclusions-prep
description: Find project build directories that are not protected by fixed-path Time Machine exclusions and stage a silent-or-confirmable result for the daily review.
---

# Time Machine Exclusions Prep

Check build directories under `~/projects` without prompting or changing Time Machine configuration. This command runs as a Phase 0 prep task and stages `.llm/gtd/review/proposals/time-machine-exclusions.json`.

## Run the check

Find build directories and print only paths that are not excluded:

```bash
find "$HOME/projects" -type d \( -name node_modules -o -name target -o -name build -o -name dist \) -prune -print0 |
	while IFS= read -r -d '' directory; do
		tmutil isexcluded "$directory" | grep -q Excluded || printf '%s\0' "$directory"
	done
```

Capture the null-delimited result without losing the command's exit status. A failed `find` or `tmutil` call stages `status: "error"`; never reinterpret a failed check as an empty result.

## Stage the result

Create `.llm/gtd/review/proposals/` and write the proposal for key `time-machine-exclusions`.

- No unmatched directories: stage `status: "empty"`, `summary.missingExclusions: 0`, and an empty `proposals` array.
- Unmatched directories: stage `status: "ready"`, include every path in `summary.directories`, and create one confirm-only proposal with empty `applyOps`.
- Check failure: stage `status: "error"` with the command error.

Use this sweep command in the ready proposal:

```bash
find "$HOME/projects" -type d \( -name node_modules -o -name target -o -name build -o -name dist \) -prune -print0 |
	sudo xargs -0 -n40 tmutil addexclusion -p
```

`sudo` requires the user, so prep never runs the sweep. Return a one-line count and stop.
