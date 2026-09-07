---
description: Recovery protocol for GTD agents and commands that depend on iMCP (mcp__imcp__* tools — calendar, reminders, contacts, photos). Use whenever an iMCP tool errors or reports the server disconnected: stop the stuck helper, relaunch, retry once, and on continued failure halt with the fatal-error contract rather than returning empty data. Also covers the reminders-completion capability gap and the photos-scanner AppleScript fallback.
---

# iMCP Recovery Protocol

Shared protocol for any GTD agent or command that depends on iMCP (`mcp__imcp__*` tools). When iMCP is unavailable, stop and get it running — proceeding with empty data silently corrupts a review or scan, so recovery is mandatory before continuing.

## Procedure

When a step requires an `mcp__imcp__*` tool:

- Call the required iMCP tool. Empty results are valid data, not failures — only connection/availability errors trigger recovery.
- On failure (tool unavailable, connection error, error response indicating iMCP not connected), **quit any unresponsive server before relaunching** — iMCP commonly stops responding after days of uptime (the app is still running but answers nothing), and `open -a iMCP` alone only focuses the stale app without restarting the stuck helper:
    - Find the helper: `pgrep -f 'iMCP.app/Contents/MacOS/imcp-server'` (or `ps aux | grep -i imcp`).
    - If found, `kill <pid>` (then `kill -9 <pid>` if it survives).
    - Relaunch a fresh server: `open -a iMCP` (installed at `/Applications/iMCP.app`), `sleep 5`, retry the call **once**.
- If the retry still fails, **STOP**. Do not return empty data. Report a fatal iMCP error (see contract below). Note that **Claude cannot run `/mcp`** — killing+relaunching makes the app fresh so the user's subsequent `/mcp` reconnect succeeds quickly, but the in-session MCP connection is only re-established by that user action.

## Proactive restart before a long run

Long-running commands (the daily review) restart a stale helper **before** the first iMCP call, so a mid-run death does not trip the fatal contract halfway through. `${CLAUDE_PLUGIN_ROOT}/scripts/imcp-helper-age.mjs` prints the helper's age in seconds (or `none` / `unknown`); a helper older than **86400** seconds (~1 day) is restarted with the kill + `open -a iMCP` + `sleep 5` recipe above.

- The age-based restart is **mandatory even if the helper still answers**. Do not probe a stale helper and skip the restart because the probe succeeded — an old-but-currently-responsive helper is exactly the one that dies partway through a long review. Age alone decides; a passing probe is not an escape hatch.
- A liveness probe is an **additional** restart trigger, never a substitute for the age rule: a failing probe restarts the helper regardless of age, a fresh or `unknown`-age helper included. The two rules only ever add restarts; neither one cancels the other's.
- `unknown` (start time unparseable) on its own is not a reason to kill a live helper; only a failed probe restarts it.

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

The reconnect halt must be a plain-text response that ends the turn. **Never issue `AskUserQuestion` for this halt**: while that prompt is open, the user cannot type `/mcp` without first pressing Esc. Tell the user how to reconnect in plain text, then return control immediately.

## Photos scanner exception

The photos scanner has a legitimate non-iMCP path (AppleScript against the Photos app). It should attempt iMCP recovery first, then fall back to AppleScript. It returns a fatal error **only if both iMCP and AppleScript fail** — AppleScript success is real data, not degradation.

## Capability gap: completing reminders

iMCP cannot **complete or update** Apple Reminders — it exposes only `reminders_create` / `reminders_fetch` / `reminders_lists`. This is a missing capability, not an outage, so it does not trigger the recovery procedure above. The fallback is `osascript` against the Reminders app — see `commands/review/daily/overview.md` → "Completing Apple Reminders" for the snippet and the recurring-rollforward / bridge-failure caveats.
