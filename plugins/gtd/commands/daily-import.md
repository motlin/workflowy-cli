---
name: daily-import
description: Refresh the Workflowy cache and review subtree for the daily review's mandatory import barrier.
---

# Daily Import

## Preflight: check credentials before anything else

Prep tasks fan out into subagents that cannot recover a broken credential themselves, and a failure only surfaces once that task has burned its full runtime. Both checks below are instant, so run them first and halt on either one.

```bash
op vault list             # 1Password: non-zero exit means Otter sync will fail
```

Do **not** use `op whoami` for this check. With 1Password desktop-app (system auth) integration — how this machine is set up — `op whoami` reports `account is not signed in` and exits 1 even while secret resolution works perfectly. It reads a session-token field that system auth never populates. Only a command that actually fetches data (`op vault list`) proves `op run` will resolve secrets.

Then confirm the **iMCP** tools are registered in this session by listing them (`ToolSearch` for `mcp__imcp__*`, or call `mcp__imcp__calendars_list`). `iMCP.app` appearing in `ps` proves nothing — only tool registration counts.

- `op vault list` fails → halt. Tell the user to unlock the 1Password desktop app (Settings → Developer → "Integrate with 1Password CLI" must be on). Do not suggest `eval $(op signin)`: it exports `OP_SESSION_*` into one shell, and every Bash tool call gets a fresh shell, so that token never reaches the barrier.
- iMCP tools absent → halt. Tell the user to run `/mcp`, **then restart the Claude Code session**.

The restart is not optional. A server connected mid-session via `/mcp` reaches the main thread only; subagents build their tool registry from the session's startup configuration, so every prep controller spawned afterward still sees no `mcp__imcp__*` tools no matter how long it waits or how many times it is redispatched. Only a session that starts with iMCP already connected gives prep tasks Apple/iCloud calendar access.

Do not fan out on a partial credential set. A halted barrier costs one restart; a fan-out on missing credentials costs the whole review and silently degrades Apple-calendar deduplication.

## Import

Run the barrier without piping or masking either exit status:

```bash
op run -- just daily
./bin/run.js cache sync-node --path "Personal,🔄 Review" --recursive
```

Verify that `cache import-api` reported fetched and changed node counts, the counts are sane, the subtree sync succeeded, and today's data is present. Return success only after positive verification. On error, timeout, missing summary, or stale data, return failure and halt the daily review.
