---
description: Recovery protocol for GTD agents and commands that depend on iMCP (mcp__imcp__* tools — calendar, reminders, contacts, photos). Use whenever an iMCP tool errors or reports the server disconnected: kill the wedged helper, relaunch, retry once, and on continued failure halt with the fatal-error contract rather than returning empty data. Also covers the reminders-completion capability gap and the photos-scanner AppleScript fallback.
---

# iMCP Recovery Protocol

Shared protocol for any GTD agent or command that depends on iMCP (`mcp__imcp__*` tools). When iMCP is unavailable, stop and get it running — proceeding with empty data silently corrupts a review or scan, so recovery is mandatory before continuing.

## Procedure

When a step requires an `mcp__imcp__*` tool:

- Call the required iMCP tool. Empty results are valid data, not failures — only connection/availability errors trigger recovery.
- On failure (tool unavailable, connection error, error response indicating iMCP not connected), **kill any hung server before relaunching** — iMCP commonly wedges after days of uptime (alive but unresponsive), and `open -a iMCP` alone only focuses the stale app without restarting the hung helper:
    - Find the helper: `pgrep -f 'iMCP.app/Contents/MacOS/imcp-server'` (or `ps aux | grep -i imcp`).
    - If found, `kill <pid>` (then `kill -9 <pid>` if it survives).
    - Relaunch a fresh server: `open -a iMCP` (installed at `/Applications/iMCP.app`), `sleep 5`, retry the call **once**.
- If the retry still fails, **STOP**. Do not return empty data. Report a fatal iMCP error (see contract below). Note that **Claude cannot run `/mcp`** — killing+relaunching makes the app fresh so the user's subsequent `/mcp` reconnect succeeds quickly, but the in-session MCP connection is only re-established by that user action.

## Fatal error contract

A fetcher or scanner that cannot recover iMCP returns this as its final JSON, instead of its normal output:

```json
{
	"status": "imcp-unavailable",
	"fatal": true,
	"message": "iMCP is unavailable. Launched /Applications/iMCP.app but the MCP connection could not be established. Reconnect iMCP (run /mcp, or restart Claude Code), then re-run the command."
}
```

A command that invokes such an agent must check for `status: "imcp-unavailable"` in the result and **halt immediately** — display the `message` to the user and stop. The check is on `status` alone; `fatal` is informational only. **Never proceed because `fatal: false`** — that flag does not authorize graceful degradation. Also never proceed because the agent returned partial Workflowy or AppleScript data alongside the unavailability flag; partial data is not a fallback. Halt without offering the user a "continue anyway" option.

## Photos scanner exception

The photos scanner has a legitimate non-iMCP path (AppleScript against the Photos app). It should attempt iMCP recovery first, then fall back to AppleScript. It returns a fatal error **only if both iMCP and AppleScript fail** — AppleScript success is real data, not degradation.

## Capability gap: completing reminders

iMCP cannot **complete or update** Apple Reminders — it exposes only `reminders_create` / `reminders_fetch` / `reminders_lists`. This is a missing capability, not an outage, so it does not trigger the recovery procedure above. The fallback is `osascript` against the Reminders app — see `commands/review/daily/overview.md` → "Completing Apple Reminders" for the snippet and the recurring-rollforward / bridge-wedge caveats.
