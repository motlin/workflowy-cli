---
name: daily-import
description: Refresh the Workflowy cache and review subtree for the daily review's mandatory import barrier.
---

# Daily Import

## Preflight: check credentials before anything else

Prep tasks fan out into subagents that cannot recover a broken credential themselves, and a failure only surfaces once that task has burned its full runtime. Both checks below are instant, so run them first and halt on either one.

```bash
timeout 90 op run -- true   # 1Password: this is the call the review actually makes
```

Use **`op run`**, not `op vault list` and not `op whoami`.

- `op whoami` reports `account is not signed in` and exits 1 under desktop-app (system auth) integration — how this machine is set up — even while secret resolution works perfectly. It reads a session-token field system auth never populates.
- `op vault list` is not sufficient either, and this is the trap: it can exit 0 while `op run` still fails. `op run` initializes a **separate** client that raises its own desktop authorization prompt, and if nobody approves that prompt it dies with `error initializing client: authorization timeout`. On 2026-08-27 `op vault list` passed the preflight cleanly and `op run` then timed out twice on the barrier and again inside the Otter scanner.

Only `op run` proves `op run` works. Warming it here means the authorization prompt is approved **once, in the foreground, while the user is present** — instead of firing inside a background subagent that cannot surface it.

**Always bound `op run` with `timeout`.** Unbounded, it waits on a prompt nobody sees: the Otter scanner subagent hung 22 minutes on it, reported nothing, and had to be killed. A `timeout` turns an invisible hang into a reportable failure.

- `timeout 90 op run -- true` fails or times out → halt. Tell the user to approve the 1Password prompt (or unlock the desktop app), then re-run. Retry once after they confirm — the second call succeeds immediately once the first authorization lands.

Then confirm the **iMCP** tools are registered in this session by listing them (`ToolSearch` for `mcp__imcp__*`, or call `mcp__imcp__calendars_list`). `iMCP.app` appearing in `ps` proves nothing — only tool registration counts.

- `op run` fails → halt. Tell the user to unlock the 1Password desktop app (Settings → Developer → "Integrate with 1Password CLI" must be on) and approve the authorization prompt. Do not suggest `eval $(op signin)`: it exports `OP_SESSION_*` into one shell, and every Bash tool call gets a fresh shell, so that token never reaches the barrier.
- iMCP tools absent → halt. Tell the user to run `/mcp`, **then restart the Claude Code session**.

Both halt messages must be plain-text responses that end the turn. Do **not** use `AskUserQuestion`: an open prompt prevents the user from typing `/mcp` and gets in the way of unlocking 1Password until they press Esc. State the recovery action in plain text and return control immediately.

The restart is not optional. A server connected mid-session via `/mcp` reaches the main thread only; subagents build their tool registry from the session's startup configuration, so every prep controller spawned afterward still sees no `mcp__imcp__*` tools no matter how long it waits or how many times it is redispatched. Only a session that starts with iMCP already connected gives prep tasks Apple/iCloud calendar access.

Do not fan out on a partial credential set. A halted barrier costs one restart; a fan-out on missing credentials costs the whole review and silently degrades Apple-calendar deduplication.

## Import

Run the barrier without piping or masking either exit status:

```bash
direnv exec . op run -- just daily
direnv exec . ./bin/run.js cache sync-node --path "Personal,🔄 Review" --recursive
```

`direnv exec .` is required, not optional. The `op://` references and the literal `WORKFLOWY_API_KEY` live in the gitignored `.envrc`, and direnv loads it through a **prompt hook** that only fires in interactive shells. Every Bash tool call is a fresh non-interactive shell, so the hook never runs and the whole `.envrc` is silently absent — `op run` then has no `op://` refs to resolve and the barrier dies on `Dropbox credentials not set` at `cache import-backups`. Running it bare works from the user's own terminal and fails only under automation, which is exactly the asymmetry that makes it easy to reintroduce.

`direnv exec .` is idempotent — harmless when direnv already loaded the environment — so always prefix the barrier with it rather than testing whether the variables happen to be set.

Verify that `cache import-api` reported fetched and changed node counts, the counts are sane, the subtree sync succeeded, and today's data is present. Return success only after positive verification. On error, timeout, missing summary, or stale data, return failure and halt the daily review.
