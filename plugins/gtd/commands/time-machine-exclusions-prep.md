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

Create `.llm/gtd/review/proposals/` and write the proposal for the inferred slug `time-machine-exclusions`.

- No unmatched directories: stage `status: "empty"`, `summary.missingExclusions: 0`, and an empty `proposals` array.
- Unmatched directories: stage `status: "ready"`, include every path in `summary.directories`, and create one confirm-only proposal with empty `applyOps`.
- Check failure: stage `status: "error"` with the command error.

Use this sweep command in the ready proposal:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/add-time-machine-exclusions.sh
```

The script does the same `find … | sudo xargs tmutil addexclusion -p` sweep, then verifies every path with `tmutil isexcluded` and exits non-zero if any remain. Stage the resolved absolute path so the user can run it without expanding the variable.

`sudo` requires the user, so prep never runs the sweep. Return a one-line count and stop.

**Tell the user to run it in a real terminal, never through Claude Code's `!` prefix.** `sudo` needs a controlling terminal to prompt for a password, and the `!` prefix does not supply one. Suggesting `! <script>` produces one of two bad outcomes: `sudo: a terminal is required to read the password`, or — when a cached credential expires mid-run — a silent hang on a prompt nobody can see, which once blocked a review for 30 minutes. The script now checks for this up front and refuses with instructions, but the apply step should not send the user down that path to begin with. Point them at Terminal or iTerm.
