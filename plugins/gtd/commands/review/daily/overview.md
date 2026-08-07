---
description: Morning orientation — pull together today's calendar, Apple Reminders, next actions, delegated/waiting items, and inbox status into one overview, then offer quick edits. Use when the user wants their morning briefing, to see what's on their plate today, or the overview portion of the daily review.
---

# GTD Daily Review

Quick morning orientation to see what's on your plate and plan your day.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the phases or per-item work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Configuration

Use the `read-metadata` skill to discover GTD paths from the Workflowy Metadata node.

**iMCP halt rule (non-negotiable):** If any fetcher agent returns `status: "imcp-unavailable"` — **regardless of the value of `fatal`** — **STOP the daily review immediately**, display the agent's `message` to the user, and do not continue. This is not a graceful-degradation step:

- Do NOT proceed because `fatal: false`. The `status: "imcp-unavailable"` alone triggers the halt.
- Do NOT proceed because the agent returned partial Workflowy data alongside the unavailability. Partial data is not a fallback for missing iMCP data.
- Do NOT present a partial review and ask the user whether to continue. Just halt and tell them how to reconnect (`/mcp` or restart Claude Code).

A review missing calendar/reminders data is not useful. The user must reconnect iMCP and re-run, even if it means the review is delayed. See `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md`.

**iMCP self-heal preflight:** Before invoking `calendar-fetcher` / `reminders-fetcher`, proactively restart a stale iMCP so the fetchers don't trip the halt rule. iMCP wedges after days of uptime (alive but unresponsive). Check the helper's age:

```bash
IMCP_AGE=$(node ${CLAUDE_PLUGIN_ROOT}/scripts/imcp-helper-age.mjs)
```

The script prints one token; branch on it:

- `none` — no helper running → launch a fresh one: `open -a iMCP`, `sleep 5`.
- a number **> 86400** — stale (older than ~1 day) → restart per the `imcp-recovery.md` recipe: `kill` the helper PID (`kill -9` if it survives), `open -a iMCP`, `sleep 5`.
- a number **≤ 86400** — fresh → proceed without restarting.
- `unknown` — helper running but start time unparseable → proceed; never kill a live helper on a parse glitch.

Because **Claude cannot run `/mcp`**, if the in-session iMCP tools are still unavailable after the restart, halt as above and tell the user to run `/mcp` — the app will already be fresh, so their reconnect succeeds immediately.

**Performance — front-load every fetch in one batch.** The two fetcher agents and the six `node get` reads have no data dependencies, so launch them all concurrently in a **single assistant message**: the `calendar-fetcher` Task, the `reminders-fetcher` Task, and the six `node get --path` Bash blocks below (Next Actions × 2, Delegate × 2, Inbox × 2). Wait for all results, then format the sections. Do not run the fetchers one after another.

**Date labels — compute with `date`, never by hand.** Derive the TODAY / TOMORROW weekday labels from the system clock; do not infer the day-of-week yourself (that produced "Thu, Jun 12" for a Friday). Capture them once up front and reuse them in the section headers:

```bash
TODAY_LABEL=$(date '+%a, %b %-d')        # e.g. Fri, Jun 26
TOMORROW_LABEL=$(date -v+1d '+%a, %b %-d')
```

**Output completeness rule:** When you print the final morning overview, every section MUST show its full content inline. Never abbreviate by referring to earlier text ("already shown above", "see prior output", "as listed earlier") — the user does not scroll back through tool calls and intermediate updates. If a section's content appeared in an earlier turn, print it again in full as part of the final overview block.

## Workflow

### Calendar Review

`calendar-fetcher` is launched in the front-loaded batch above (not sequentially): pass `startDate`=today 00:00:00 ISO, `endDate`=day-after-tomorrow 00:00:00 ISO, `includeWorkflowy: true`. Returns `{fantastical, workflowy, summary, errors}`.

#### Format

Combine the agent's output into unified display:

```text
📅 TODAY'S CALENDAR
Fantastical (via EventKit):
  - 10:00 AM - Team standup (calendar-name)
  - 2:00 PM - Dentist (calendar-name)
  - All day - Holiday (calendar-name)
> Open Fantastical for full view: fantastical://

Workflowy:
  - (items from workflowy array matching today's date)
```

Use `$TODAY_LABEL` in the "📅 TODAY'S CALENDAR" header. Then show "📅 **Tomorrow Preview — $TOMORROW_LABEL:**" in the same format, filtering for tomorrow's date — taking the weekday from `$TOMORROW_LABEL`, never hand-computed.

Include the Fantastical deep link (`fantastical://`) to allow quick access to the full calendar view.

### Apple Reminders

`reminders-fetcher` is launched in the same front-loaded batch above. Returns `{overdue, dueToday, dueTomorrow, noDueDateCount, summary, errors}`.

Format the agent's output as:

```text
🔔 APPLE REMINDERS
Overdue (2):
  - 🔴 Overdue reminder 1 (Dec 15)
  - 🔴 Overdue reminder 2 (Dec 20)

Due Today (3):
  - Reminder with time (1:00 PM)
  - Another reminder (2:40 PM)
  - Morning reminder (9:05 AM)

Due Tomorrow (1):
  - Tomorrow's reminder

No due date: 3 items
```

### Next Actions

List Next Actions from both contexts using `node get` with `--path`:

```bash
./bin/run.js node get --path "Personal,☑️ Next (Personal)" --depth 1 --json --fields name,completedAt,shortId,children
./bin/run.js node get --path "Work,☑️ Next (Work)" --depth 1 --json --fields name,completedAt,shortId,children
```

Filter to `completedAt == null` (the `completedAt` field, not `completed`). Format as "☑️ **Next Actions:**" with items grouped by context (Personal / Work).

**Future-dated filtering:** Hide items with a `<time>` tag whose start date is more than 3 days from today. These are deferred and not actionable yet.

**Quick Wins:** Scan for items containing `<2min` or `2 min` or similar patterns. Highlight these as quick wins that can be done immediately.

### Delegate / Waiting For

List items delegated or waiting on others:

```bash
./bin/run.js node get --path "Personal,📤 Delegate" --depth 1 --json --fields name,completedAt,shortId,children
./bin/run.js node get --path "Work,📤 Delegate" --depth 1 --json --fields name,completedAt,shortId,children
```

Filter to `completedAt == null`. Format as "📤 **Delegate / Waiting For:**" — flag items that seem overdue or need follow-up.

### Inbox Status

Count inbox items:

```bash
./bin/run.js node get --path "Personal,📥 Inbox" --depth 1 --json --fields name,shortId,children
./bin/run.js node get --path "Work,📥 Inbox" --depth 1 --json --fields name,shortId,children
```

Also check the root Inbox:

```bash
./bin/run.js node list --parent-id <root-inbox-id> --json
```

Format as "📥 **Inbox Status:**" showing count for each. If combined count > 10, suggest running `/gtd:inbox` after daily review.

### Interactive overview (HTML in the browser)

Present the overview as a **served HTML page the user marks up in the browser**, not a console wall of text — the user checks off what they've done and the review applies those completions. (Still print a one-line console digest — counts of calendar items / overdue reminders / next actions / inbox — so the run has a textual record and a fallback if the browser fails.)

**Render the page.** Build the page from the gathered sections (today + tomorrow calendar, reminders, next actions, delegate, inbox) using the `review-proposal-batch` skill, and write it to `.llm/gtd/review/overview.html`. Make each **completable** item a checkbox row carrying the data attributes the server reads:

- `data-id` — for Workflowy items the **full UUID**; for Apple Reminders the reminder **title**.
- `data-source` — `workflowy` or `reminder`.
- `data-label` — the human-readable item text (used in the apply summary).

```html
<label
	><input
		type="checkbox"
		data-id="<full-uuid>"
		data-source="workflowy"
		data-label="Pay rent"
	/>
	Pay rent</label
>
<label
	><input
		type="checkbox"
		data-id="Take out trash"
		data-source="reminder"
		data-label="Take out trash"
	/>
	Take out trash</label
>
```

Calendar events are display-only (no checkbox). Next Actions, Delegate, overdue/today Reminders, and Inbox items are completable.

**Serve it and open it.** Start the server in the background and open the page:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/serve-overview.mjs --html .llm/gtd/review/overview.html --out .llm/gtd/review/overview-checks.json --port 7842 &
```

It prints `OVERVIEW_URL http://127.0.0.1:7842/`. Confirm it's actually up before pointing the user at it — `curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:7842/` should print `200` (don't use `lsof` for this check; it can hang stat-ing network mounts). Then `open http://127.0.0.1:7842/`.

**Approve through Claude Code, not the page's Done button.** The page is for _reading_ the overview; the approval happens in this conversation. Never block on an unbounded poll waiting for a submit that usually never comes.

After opening the page, immediately ask with a single `AskUserQuestion` what to complete — listing the completable items (Next Actions, Delegate, overdue/today Reminders, Inbox) as `multiSelect` options so the user picks them right here. Read `.llm/gtd/review/overview-checks.json` first: if the user did click Done, it already holds their selections and you fold those in rather than re-asking.

Then for each selected entry, complete it by `source`:

- `workflowy` → `./bin/run.js node complete --id <data-id>`
- `reminder` → iMCP has no complete tool, so use `osascript` (see [Completing Apple Reminders](#completing-apple-reminders) below)

Report which items were completed. Then stop the server (`pkill -f serve-overview.mjs`). If the user wants a move rather than a completion, they can say so and you run `./bin/run.js node move --node-id <full-uuid> --parent-path "Section,Subsection" -p top|bottom` (Someday → `-p top`, else `-p bottom`); the page itself is for completion only.

### Next Step

Do **not** prompt "what would you like to do next?" — the daily review's phase ordering is deterministic. After completions are applied, proceed directly: when invoked as part of `/gtd:review:daily`, the orchestrator advances to the next phase (Recurring Review). When invoked standalone, simply end after logging completion.

### Log Completion

After completing the review, log to Session Memory:

```bash
TODAY=$(date +%Y-%m-%d)
TIME=$(date +%H:%M)
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory,$TODAY" --name "daily-review: $TIME - completed"
```

If the date node doesn't exist, create it first:

```bash
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory" --name "$TODAY"
```

## Creating Events via Fantastical

To create a calendar event from a task or inbox item:

```bash
osascript -e 'tell application "Fantastical" to parse sentence "Meeting with John tomorrow at 2pm" with add immediately'
```

## Completing Apple Reminders

Reminders are surfaced by `reminders-fetcher` (read-only), and **iMCP exposes no complete/update tool** — only `reminders_create` / `reminders_fetch` / `reminders_lists`. To actually mark an Apple Reminder done (e.g. when the user checks one off in Quick Edits), use `osascript` against the Reminders app:

```applescript
tell application "Reminders"
	set matches to (reminders of list "Reminders" whose completed is false and name is "<title>")
	if (count of matches) > 0 then set completed of (item 1 of matches) to true
end tell
```

- The fetcher returns `list: null`, so iterate `lists` to find the right one if it isn't the default "Reminders" list.
- **Recurring reminders roll forward**: completing the overdue instance creates a fresh incomplete one at the next occurrence — verify with `reminders_fetch completed:false query:"<title>"`. You can't permanently clear a repeating series without deleting it; leave it unless the user asks.
- The Reminders/AppleScript bridge **can wedge** (an ~8s script once hung past 25s mid-iCloud-sync). Run it backgrounded with a timeout guard (`kill -9` after ~25s) and confirm the result via the fast `reminders_fetch`, not the script's own output.
