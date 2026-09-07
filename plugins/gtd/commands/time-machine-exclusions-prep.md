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

## Group the result

Pipe the null-delimited paths through the grouping script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/group-build-dirs.mjs
```

It prints `{durable, worktrees, report}`. Paths under `<repo>/.worktrees/<worktree>/` collapse into one `worktrees` entry per repo (`{repo, worktreeCount, dirCount}`); everything else is `durable`. `report` is the human-readable list: each durable path on its own line, then one `N build dirs across M worktrees under <repo>` line per repo.

Worktree build output is still regenerable and still gets excluded -- the sweep and the verification use the full path list. Only the presentation collapses, so one repo with hundreds of Maven `target/` dirs cannot bury the few durable paths that matter.

**Never exclude the `.worktrees` root itself, and never skip it in the scan.** Worktrees share one Git object database, and a worktree with uncommitted changes is exactly the source that needs backing up. The user removes fully-committed worktrees with `git clean worktrees`; that is the fix for the churn, not an exclusion.

## Stage the result

Create `.llm/gtd/review/proposals/` and write the proposal for the inferred slug `time-machine-exclusions`.

- No unmatched directories: stage `status: "empty"`, `summary.missingExclusions: 0`, and an empty `proposals` array.
- Unmatched directories: stage `status: "ready"`, include every path in `summary.directories`, copy the script's `durable`, `worktrees`, and `report` fields into `summary`, and create one confirm-only proposal with empty `applyOps`. Set the proposal `detail` from `summary.report`, never from the full directory list.
- Check failure: stage `status: "error"` with the command error.

Use this sweep command in the ready proposal:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/add-time-machine-exclusions.sh
```

The script does the same `find … | sudo xargs tmutil addexclusion -p` sweep, then verifies every path with `tmutil isexcluded` and exits non-zero if any remain. Stage the resolved absolute path so the user can run it without expanding the variable.

`sudo` requires the user, so prep never runs the sweep. Return a one-line count and stop.

**Tell the user to run it in a real terminal, never through Claude Code's `!` prefix.** `sudo` needs a controlling terminal to prompt for a password, and the `!` prefix does not supply one. Suggesting `! <script>` produces one of two bad outcomes: `sudo: a terminal is required to read the password`, or — when a cached credential expires mid-run — a silent hang on a prompt nobody can see, which once blocked a review for 30 minutes. The script now checks for this up front and refuses with instructions, but the apply step should not send the user down that path to begin with. Point them at Terminal or iTerm.
