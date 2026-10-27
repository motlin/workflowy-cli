---
name: openrewrite-sync-prep
description: Prep half of the OpenRewrite fork sync — rebase each OpenRewrite checkout's main onto upstream, build and publish its SNAPSHOT to ~/.m2, and stage which fork mains are ready to push. Autonomous only; never pushes.
---

# OpenRewrite Fork Sync Prep

Keep every OpenRewrite fork's `main` equal to upstream `main` plus the local fixes. This prep half does all the slow, local work and stages `.llm/gtd/review/proposals/openrewrite-sync.json`. It never pushes; `/gtd:openrewrite-sync-apply` asks before any push.

## Run the sync without pushing

Run the sync script once, in the foreground of this worker, with no timeout shorter than 90 minutes (the `rewrite` build alone takes 10–20 minutes):

```bash
mkdir -p .llm/gtd/review/proposals
openrewrite-sync --no-push --summary-json .llm/gtd/review/proposals/openrewrite-sync.raw.json
```

The script lives at `~/.local/bin/openrewrite-sync`. For each repo in dependency order (`rewrite`, `rewrite-static-analysis`, `rewrite-cucumber-jvm`, `rewrite-logging-frameworks`, `rewrite-github-actions`, `rewrite-joda`, `rewrite-jenkins`, `rewrite-migrate-java`, `rewrite-testing-frameworks`, `rewrite-polyglot`, `rewrite-maven-plugin` under `~/projects`) it fetches, rebases `main` onto `upstream/main`, and builds and publishes the SNAPSHOT when `main` changed. A rebase conflict aborts that repo's rebase and leaves `main` unchanged. It writes one JSON object per repo: `repo`, `status` (`ok` or `failed`), `detail`, `localCommits`, `forkMainDiffers`, and `log`.

- A non-zero exit with a summary file means some repos failed; that is a normal `ready` result, not a prep error.
- A missing summary file, a missing script, or `Another openrewrite-sync is running` is a prep error.
- Never call `op`. Git pushes are not part of prep, and Gradle reads its repository credentials from `~/.gradle/gradle.properties`.

## Stage the result

For each repo in the summary, read the exact commits to push now, so apply pushes what was built even if `main` moves later:

```bash
git -C ~/projects/<repo> rev-parse main
git -C ~/projects/<repo> rev-parse -q --verify origin/main
```

Write `.llm/gtd/review/proposals/openrewrite-sync.json` with `task: "openrewrite-sync"` and `presentation: "OpenRewrite fork sync"`:

- Every repo `ok` and no `forkMainDiffers`: `status: "empty"`, empty `proposals`.
- Prep error: `status: "error"` with the message.
- Otherwise `status: "ready"`. `summary.repos` holds the raw records. Add one proposal per repo that needs attention:
    - `ok` with `forkMainDiffers: true`: header `<repo>`, detail `push main (upstream + N local commits)`, and one applyOp:

        ```bash
        git -C ~/projects/<repo> push --force-with-lease=main:<origin-main-sha> origin <main-sha>:refs/heads/main
        ```

        When the fork has no `main`, use `--force-with-lease=main:` (empty expected value).

    - `failed`: header `<repo>`, the failure `detail` and log path, and empty `applyOps`. These are informational: a rebase conflict or build failure needs a fix session, not a push.

Return a one-line count (repos synced, pushes staged, failures) and stop.
