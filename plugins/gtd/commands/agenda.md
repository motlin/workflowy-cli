---
description: Propose today's per-meeting agendas by matching queued discussion topics to today's calendar meetings, then serve an interactive review page. Use whenever the user wants to prep for the day's meetings, asks what to raise in their 1:1s, or wants queued talking points turned into per-meeting agendas.
---

# GTD Meeting Agendas

Read the discussion topics queued under `📋 Meeting agendas`, fetch today's meetings, match each topic to the meeting where you'll raise it, and serve an interactive review page on <http://127.0.0.1:7842/> proposing the agenda for each meeting.

This is the prep-and-serve half of the Proposed Meeting Agendas feature. The refinement half (`gtd:agenda-detector`) routes captured items into the `📋 Meeting agendas` node; this command turns that queue into a daily agenda.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the phases or per-topic work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Inputs

- `--days N` (optional, default `1`) — size of the meeting window starting today. `--days 1` = today only; `--days 2` = today and tomorrow.

## Refresh people metadata

Launch the metadata-sync agent so `.llm/gtd/metadata/people.json` holds current name → alias mappings for fuzzy matching topics to attendees.

```text
Task tool:
- subagent_type: "gtd:metadata-sync"
  prompt: "Sync GTD metadata to .llm/gtd/metadata/ for the agenda command."
```

Wait for it to complete. `people.json` is large (40k+ lines) — never read it whole; extract `@`-handles and aliases with `jq` when matching below.

## Fetch today's meetings

Invoke `calendar-fetcher` with `startDate` = today `00:00:00` ISO, `endDate` = today + (`--days` − 1) days at `23:59:59` ISO (so `--days 1` ends today, `--days 2` ends tomorrow), and `includeWorkflowy: false` — only real calendar meetings matter here, not Workflowy calendar items.

```text
Task tool:
- subagent_type: "gtd:calendar-fetcher"
  prompt: "Fetch calendar events from <startDate> to <endDate>, includeWorkflowy=false."
```

The agent returns `{fantastical, workflowy, summary, errors}`. Use the `fantastical` array. For each meeting capture `title`, `start`, `end`, and any `attendees`/`location` present.

**iMCP halt rule (non-negotiable):** If `calendar-fetcher` returns `status: "imcp-unavailable"` — regardless of the `fatal` value — **STOP immediately**, show the agent's `message`, and do not continue. A proposed agenda without the day's real meetings is not useful. Tell the user to reconnect iMCP (`/mcp` or restart Claude Code); see `${CLAUDE_PLUGIN_ROOT}/skills/imcp-recovery.md`.

Skip all-day events and obvious non-meetings (holidays, focus blocks) when matching — they are listed in the unmatched section but rarely host topics.

## Read queued topics

Read the `📋 Meeting agendas` node (short id `29bda59a1f54`, full `f3bfcfbb-a904-62e6-06aa-29bda59a1f54`):

```bash
./bin/run.js node get --id 29bda59a1f54 --depth 2 --json
```

For each child topic capture:

- `text` — the topic name
- `@mentions` — `@`-handles in the text (the person to raise it with)
- `children` — link/detail child nodes (URLs, context) to show on the card
- `shortId` — for the card's `href`/`linkText`

## Match topics to meetings

For each topic, decide which meeting (if any) it belongs to:

- **Topic with an `@person`:** resolve the handle to a canonical name and aliases via `people.json` (use `jq` to pull just that person's `name`/aliases — never read the file whole). Fuzzy-match the name/aliases against each meeting's title and attendees, the same loose approach `commands/review/daily/meetings.md` uses for misheard names — substring and first-name matches count. The best-matching meeting wins.
- **Topic without an `@person`:** keyword/project match against meeting titles (shared project name, distinctive keyword). If nothing matches, place it in the **"Unassigned / no meeting today"** bucket.

**Never silently hide a topic.** Every queued topic appears on the page — either matched to a meeting or in the unassigned bucket. Likewise list meetings in the window that have no queued topics, so gaps are visible.

## Build the report spec

Write `.llm/gtd/agenda/proposals.json` matching the `review-proposal-batch` schema (`title`, `subtitle`, `cards[]`). Create the `.llm/gtd/agenda/` directory first.

- `title`: e.g. `"Proposed Meeting Agendas"`.
- `subtitle`: the window and counts, e.g. `"Wed, Jun 25 · 3 topics across 2 meetings · Accept/Reject to confirm"`.
- One card per matched topic:
    - `heading`: `"🕐 2:00pm · 1:1 Alice"` (meeting time + short title).
    - `body`: the topic text plus any child links/detail.
    - `href` / `linkText`: the topic's Workflowy URL and short id (`linkText` is the card id used by the decisions log).
    - `note`: the match reasoning (`"@AliceBrown → 1:1 Alice (attendee match)"`), which renders italic with ⚠️.
- A trailing section of cards for unmatched topics (heading `"❓ Unassigned / no meeting today"`) and for meetings with no queued topics (heading `"🗓️ <meeting> · no topics queued"`).

## Render and serve

Render and serve the page in the background on port 7842 (the script blocks):

```bash
python3 .claude/skills/review-proposal-batch/render_report.py \
  .llm/gtd/agenda/proposals.json .llm/gtd/agenda/proposals.html --open --serve 7842
```

Each card gets Accept / Reject / Later buttons; clicks append to `.llm/gtd/agenda/proposals.decisions.jsonl` (latest line per card id wins; ids come from `linkText`).

**MVP is review-only** — Accept records a decision but does not mutate any node. (A future enhancement can pass `--apply-cmd` so Accept marks a discussed topic complete via `./bin/run.js node complete --id {id}`; decide the post-meeting action before wiring that.)

Verify the server is actually up before telling the user to open it:

```bash
lsof -i -P -n | grep 7842        # expect a LISTEN line
curl -sI http://127.0.0.1:7842/  # expect a non-error response
```

Only after both checks pass, point the user at <http://127.0.0.1:7842/>.

## Output

Report a brief summary:

```text
📋 Proposed Meeting Agendas (Wed, Jun 25)
Meetings in window: 2
Topics queued: 3 — matched: 2, unassigned: 1
Review page: http://127.0.0.1:7842/
```
