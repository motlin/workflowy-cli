---
description: Recovery protocol for GTD agents and commands that depend on iMCP (mcp__imcp__* tools — calendar, reminders, contacts, photos). Use whenever an iMCP tool errors or reports the server disconnected: stop the stuck helper, relaunch, retry once, and on continued failure return the imcp-unavailable result rather than empty data. Also covers the halt rule for callers that receive that result, the reminders-completion capability gap, and the photos-scanner AppleScript fallback.
---

# iMCP Recovery Protocol

Shared protocol for any GTD agent or command that depends on iMCP (`mcp__imcp__*` tools). When iMCP is unavailable, stop and get it running — proceeding with empty data silently corrupts a review or scan, so recovery is mandatory before continuing.

## Procedure

When a step requires an `mcp__imcp__*` tool:

- Call the required iMCP tool. Empty results are valid data, not failures — only connection/availability errors trigger recovery.
- On failure (tool unavailable, connection error, error response indicating iMCP not connected), **quit any unresponsive server before relaunching** — iMCP commonly stops responding after days of uptime (the app is still running but answers nothing), and `open -a iMCP` alone only focuses the stale app without restarting the stuck helper:
    - Find **this session's** helper: `node ${CLAUDE_PLUGIN_ROOT}/scripts/imcp-helper-age.mts --pid`. Every Claude session spawns its own `imcp-server`, so `pgrep -f` matches dozens; the script walks this process's ancestors and returns only the helper parented by this session's `claude` (or `none`). Never kill helpers found by `pgrep` / `ps aux` — they belong to other sessions.
    - If it printed a pid, `kill <pid>` (then `kill -9 <pid>` if it survives). Report and kill only that pid.
    - Relaunch a fresh server: `open -a iMCP` (installed at `/Applications/iMCP.app`), `sleep 5`, retry the call **once**.
- If the retry still fails, stop and return the unavailable result below instead of empty data. Claude cannot run `/mcp` itself: killing and relaunching makes the app fresh so the user's `/mcp` reconnect succeeds quickly, but only that user action re-establishes the in-session MCP connection. After `/mcp`, probe from a subagent (`calendars_list`) rather than assuming a session restart is needed; restart only if the probe fails.

## Proactive restart before a long run

Long-running commands (the daily review) restart a stale helper **before** the first iMCP call, so a mid-run death does not trip the halt rule halfway through. `${CLAUDE_PLUGIN_ROOT}/scripts/imcp-helper-age.mts` prints this session's helper's age in seconds (or `none` / `unknown`); a helper older than **86400** seconds (~1 day) is restarted with the kill + `open -a iMCP` + `sleep 5` recipe above.

- The age-based restart applies even if the helper still answers. Do not probe a stale helper and skip the restart because the probe succeeded — an old-but-currently-responsive helper is exactly the one that dies partway through a long review. Age alone decides; a passing probe is not an escape hatch.
- A liveness probe is an **additional** restart trigger, never a substitute for the age rule: a failing probe restarts the helper regardless of age, a fresh or `unknown`-age helper included. The two rules only ever add restarts; neither one cancels the other's.
- `unknown` (start time unparseable) on its own is not a reason to kill a live helper; only a failed probe restarts it.

## Unavailable result

A fetcher or scanner that cannot recover iMCP returns this as its entire response, in place of its normal output and with no partial data alongside it:

```json
{
	"status": "imcp-unavailable",
	"message": "iMCP is unavailable. Launched /Applications/iMCP.app but the MCP connection could not be established. Reconnect iMCP (run /mcp, or restart Claude Code), then re-run the command."
}
```

Empty arrays or Workflowy-only results are not a substitute: a caller cannot tell them apart from a genuinely empty calendar or reminders list, so it would carry on with a review that silently drops the day's meetings and reminders.

## Halt rule for callers

A command that receives `status: "imcp-unavailable"` from any agent stops its run there. It shows the agent's `message`, tells the user to reconnect iMCP with `/mcp` (or by restarting Claude Code) and re-run, and ends the turn. It does not continue on whatever other data it has, because a review, agenda, capture, or journal run without the calendar and reminders data is not useful and its later steps (dedup, date advancement) would act on an incomplete picture.

The halt message is plain text, not `AskUserQuestion`: while a question prompt is open, the user cannot type `/mcp` without first pressing Esc.

## Photos scanner exception

The photos scanner has a legitimate non-iMCP path (AppleScript against the Photos app). It should attempt iMCP recovery first, then fall back to AppleScript. It returns the unavailable result only if both iMCP and AppleScript fail — AppleScript success is real data, not degradation.

## Capability gap: completing reminders

iMCP cannot **complete or update** Apple Reminders — it exposes only `reminders_create` / `reminders_fetch` / `reminders_lists`. This is a missing capability, not an outage, so it does not trigger the recovery procedure above. The fallback is `osascript` against the Reminders app — see `commands/review/daily/overview.md` → "Completing Apple Reminders" for the snippet and the recurring-rollforward / bridge-failure caveats.
