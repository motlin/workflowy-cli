---
name: time-machine-exclusions-apply
description: Silently finish a clean Time Machine exclusion check or ask the user to run and verify the fixed-path sweep when prep found unmatched build directories.
---

# Time Machine Exclusions Apply

Read `.llm/gtd/review/proposals/time-machine-exclusions.json` and act on its status.

## Handle the staged status

- `empty`: report nothing and return success. The DAG executor advances the date without prompting.
- `error`: surface the error and return failure. Do not advance the date.
- `ready`: show `summary.report` (each durable path, plus one aggregate line per repo for build dirs inside `.worktrees/` and one for build dirs inside `.llm/conflicts-*/` checkouts), launch the staged sweep command in a herdr tab (below), then ask whether it finished. Never expand an aggregate into individual paths, and never suggest excluding or skipping a `.worktrees` root -- a worktree with uncommitted changes needs backing up.

## Launch the sweep in a herdr tab

Do not tell the user to copy the command into another terminal. Start it for them in a new herdr tab, which is a real terminal, so `sudo` can prompt for the password there:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/launch-herdr-tab.mjs --label time-machine -- <staged sweep command>
```

Pass the resolved absolute sweep path from the proposal. The script resolves this session's own pane with `herdr pane current`, creates a focused tab labelled `time-machine` in that workspace, moves it to sit **immediately right of the review's tab** (`herdr tab create` alone appends it last, and the CLI has no move command, so the script uses the socket API's `tab.move`), and runs the command there. It prints `{label, number, tabId, paneId, workspaceId, rightOfTabId}`.

- Always keep `--label time-machine`. An unlabelled tab shows only its number, and the user cannot find it.
- Read the pane back with `herdr pane read <paneId>` and confirm the script started (a `Password:` prompt or scan output), not a bare shell prompt with the command un-executed.

Then ask with AskUserQuestion. Put everything the user must act on inside the question itself, since the surrounding console output scrolls away:

- The tab label (`time-machine`), its number, and that it sits immediately right of the review's tab.
- A reminder that the script is waiting for their sudo password and they must type it in that tab.
- Options: finished, not now, skip.

If the launch script fails (herdr unavailable, or the socket request errors), fall back to showing the command and telling the user to run it in Terminal or iTerm -- never through Claude Code's `!` prefix, which has no terminal for the password prompt.

## Verify

On "not now" or skip, return skipped and leave the date unchanged. When the user says it finished, read the pane once more to check the script's exit, then rerun the no-sudo check from `/gtd:time-machine-exclusions-prep` before returning success.

Verify against the **staged** `summary.directories` list, not the raw scan total. Build directories appear constantly on this machine (every new worktree adds `node_modules`), so a fresh scan almost always finds paths that did not exist when prep ran. Failing on those makes the task permanently unsatisfiable.

- Every staged path now excluded → success, even when the rescan lists new paths. Report the new ones as a count so the next run picks them up; a rescan that only finds worktree churn is still success.
- Any staged path still unexcluded, or the check itself errors → show the result and return failure; never advance based on confirmation alone.

The apply command never runs `sudo` and never updates the task date. The Phase 0 executor owns the name-matched date operation.
