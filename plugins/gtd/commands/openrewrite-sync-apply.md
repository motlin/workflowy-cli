---
name: openrewrite-sync-apply
description: Apply half of the OpenRewrite fork sync — show which fork mains were rebased and built, hand the user the push command, verify the pushes, and report repos whose rebase or build failed.
---

# OpenRewrite Fork Sync Apply

Read `.llm/gtd/review/proposals/openrewrite-sync.json` and act on its status.

## Handle the staged status

- `empty`: report nothing and return success. The DAG executor advances the date.
- `error`: surface the error and return failure. Do not advance the date.
- `ready`: present the repos, push what the user approves, and report failures (below).

## Hand the push to the user

Never push `main` yourself: a guard hook forbids pushing to `main`, and the user runs those pushes. When any proposal has an `applyOps` push, show each repo and its local commit count, then ask with AskUserQuestion. Put the command inside the question, because console output scrolls away:

```text
! openrewrite-sync --no-build
```

It pushes every fork `main` that differs, each with `--force-with-lease`, and skips the rebuild prep already did. Options: pushed, not now.

- On "pushed", verify each staged repo with `git -C ~/projects/<repo> ls-remote origin refs/heads/main` matching the staged SHA. A mismatch because the fork moved since prep (lease rejection) is reported and left for the next run.
- On "not now", return skipped.

## Report failures

List each `failed` proposal with its detail and log path. A rebase conflict or build failure needs a fix session in that repo. Offer to start one with AskUserQuestion (start a fix now, later). For "now", launch Claude in a labelled herdr tab next to the review:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/launch-herdr-tab.mts --label <repo> -- bash -lc 'cd ~/projects/<repo> && claude "Rebase main onto upstream/main, resolve the conflicts or build failure described in <log>, and verify with git test run upstream/main..main. Do not push."'
```

## Result

- Return success when every staged push is verified, even if some repos failed to rebase or build: those reappear on the next run.
- Return skipped when the user chose "not now"; the date stays unchanged.
- Return failure when a push the user ran could not be verified for a reason other than a lease rejection.

The apply command never updates the task date. The Phase 0 executor owns it.
