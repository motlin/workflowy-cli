---
name: openrewrite-sync-apply
description: Apply half of the OpenRewrite fork sync — show which fork mains were rebased and built, ask which to push, push the approved ones with --force-with-lease, and report repos whose rebase or build failed.
---

# OpenRewrite Fork Sync Apply

Read `.llm/gtd/review/proposals/openrewrite-sync.json` and act on its status.

## Handle the staged status

- `empty`: report nothing and return success. The DAG executor advances the date.
- `error`: surface the error and return failure. Do not advance the date.
- `ready`: present the repos, push what the user approves, and report failures (below).

## Ask which forks to push

When any proposal has an `applyOps` push, ask with AskUserQuestion (`multiSelect: true`). Put everything the user needs inside the question, because console output scrolls away: each repo, its local commit count, and that the push is a `--force-with-lease` rewrite of the fork's `main`. Options: push all, one option per repo when there are three or fewer, and not now.

- Run each approved applyOp verbatim. The staged SHAs pin exactly what prep built; never substitute the current `main`.
- A lease rejection means the fork moved since prep. Report it and leave that repo for the next run; never retry with `--force`.
- Verify each push with `git -C <repo> ls-remote origin refs/heads/main` matching the staged SHA.

## Report failures

List each `failed` proposal with its detail and log path. A rebase conflict or build failure needs a fix session in that repo. Offer to start one with AskUserQuestion (start a fix now, later). For "now", launch Claude in a labelled herdr tab next to the review:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/launch-herdr-tab.mts --label <repo> -- bash -lc 'cd ~/projects/<repo> && claude "Rebase main onto upstream/main, resolve the conflicts or build failure described in <log>, and verify with git test run upstream/main..main. Do not push."'
```

## Result

- Return success when every approved push is verified, even if some repos failed to rebase or build: those reappear on the next run.
- Return skipped when the user chose "not now" for all pushes; the date stays unchanged.
- Return failure when an approved push could not be verified for a reason other than a lease rejection.

The apply command never updates the task date. The Phase 0 executor owns it.
