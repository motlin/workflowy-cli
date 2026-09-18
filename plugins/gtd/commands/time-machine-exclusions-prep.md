---
name: time-machine-exclusions-prep
description: Find project build directories that are not protected by fixed-path Time Machine exclusions and stage a silent-or-confirmable result for the daily review.
---

# Time Machine Exclusions Prep

Check build directories under `~/projects` without prompting or changing Time Machine configuration. This command runs as a Phase 0 prep task and stages `.llm/gtd/review/proposals/time-machine-exclusions.json`.

## Run the check

Find build directories and print only paths that are not excluded:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-build-dirs.mjs
```

It walks `~/projects` for `node_modules`, `target`, `build`, and `dist` directories, pruning below each match, asks `tmutil isexcluded` about them in batches, and prints the unexcluded paths null-delimited on stdout.

Capture the null-delimited result without losing the command's exit status. The script separates two kinds of trouble:

- **A directory that vanishes mid-walk is not a failure.** `~/projects` is live while the scan runs -- a `.git/rebase-merge` dir disappears the moment a rebase finishes. The script prunes that one subtree, keeps walking, and notes it on stderr as `vanished mid-scan, skipped: <path>`. A directory that no longer exists has no build output to exclude, so exit status stays 0 and the result is complete. Never re-run the sweep because of these lines, and never stage them as an error.
- **A non-zero exit is a real failure** -- permission denied, a missing scan root, a `tmutil` crash, or `tmutil` unable to classify a path that still exists. Stage `status: "error"` with the stderr text; never reinterpret a failed check as an empty result.

Run the script once. Do not substitute a hand-rolled `find` pipeline: `find` exits non-zero on a vanished directory, which makes a transient entry indistinguishable from a real failure and once forced a full second sweep that doubled the prep's runtime.

## Group the result

Pipe the null-delimited paths through the grouping script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/group-build-dirs.mjs
```

It prints `{durable, worktrees, conflicts, report}`. Paths under `<repo>/.worktrees/<worktree>/` collapse into one `worktrees` entry per repo (`{repo, worktreeCount, dirCount}`). Paths under a `<repo>/.llm/conflicts-*/` scratch checkout collapse the same way into one `conflicts` entry per repo (`{repo, checkoutCount, dirCount}`). Everything else is `durable`. `report` is the human-readable list: each durable path on its own line, then one `N build dirs across M worktrees under <repo>` line per repo, then one `N build dirs across M conflicts checkouts under <repo>/.llm` line per repo.

Worktree and conflicts-checkout build output is still regenerable and still gets excluded -- the sweep and the verification use the full path list. Only the presentation collapses, so one repo with hundreds of Maven `target/` dirs cannot bury the few durable paths that matter.

**Never exclude the `.worktrees` root itself, and never skip it in the scan.** Worktrees share one Git object database, and a worktree with uncommitted changes is exactly the source that needs backing up. The user removes fully-committed worktrees with `git clean worktrees`; that is the fix for the churn, not an exclusion.

## Stage the result

Create `.llm/gtd/review/proposals/` and write the proposal for the inferred slug `time-machine-exclusions`.

- No unmatched directories: stage `status: "empty"`, `summary.missingExclusions: 0`, and an empty `proposals` array.
- Unmatched directories: stage `status: "ready"`, include every path in `summary.directories`, copy the script's `durable`, `worktrees`, `conflicts`, and `report` fields into `summary`, and create one confirm-only proposal with empty `applyOps`. Set the proposal `detail` from `summary.report`, never from the full directory list.
- Check failure: stage `status: "error"` with the command error.

Use this sweep command in the ready proposal:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/add-time-machine-exclusions.sh
```

The script runs the same `scan-build-dirs.mjs` scan (so tracked-source directories named `build`/`dist` are never excluded), pipes the result through `sudo xargs tmutil addexclusion -p`, then verifies every path with `tmutil isexcluded` and exits non-zero if any remain. Stage the resolved absolute path so the user can run it without expanding the variable.

`sudo` requires the user, so prep never runs the sweep. Return a one-line count and stop.

**Tell the user to run it in a real terminal, never through Claude Code's `!` prefix.** `sudo` needs a controlling terminal to prompt for a password, and the `!` prefix does not supply one. Suggesting `! <script>` produces one of two bad outcomes: `sudo: a terminal is required to read the password`, or — when a cached credential expires mid-run — a silent hang on a prompt nobody can see, which once blocked a review for 30 minutes. The script now checks for this up front and refuses with instructions, but the apply step should not send the user down that path to begin with. Point them at Terminal or iTerm.
