---
description: Walk Otter-ingested meetings since the last review, flag probable follow-ups (weighting asks from your manager and skip-level), confirm each with you, and drop accepted items into the Inbox. Use when the user wants to review recent meetings, catch up on meeting follow-ups, or extract action items from meeting transcripts.
---

# Meeting Follow-up Review

Walk recent Otter-ingested meetings since the last review and capture probable follow-ups to the Inbox.

- Otter transcripts contain misheard text and rough speaker guesses, so a passive scanner is not enough.
- Uses real project context to ground judgments.
- Weights probable follow-ups from direct manager / manager's manager.
- Checks every candidate against the tasks you already track before proposing it.
- Confirms each candidate with the user before recording.

## Do not use the built-in task list

Track all progress through `.llm/` files, Workflowy nodes, and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) to mirror the meetings or per-candidate work in this command — they clutter the display and are never cleaned up.

(Note: launching **subagents** via the `Task` tool / `subagent_type` is unrelated to the built-in task list and is expected.)

## Configuration

Use the `read-metadata` skill to discover GTD paths from the Workflowy Metadata node.

## Inputs

- **Watermark** — last-reviewed timestamp from a Workflowy scanner-state node
- **VIP list** — direct manager(s) and manager's manager(s) from `.llm/gtd/metadata/people.json`
- **Recent meetings** — Otter meeting entries under `📆 Calendar` dated since the watermark
- **Project context** — active project names and recent task titles, used to ground LLM judgment
- **Existing open tasks** — Next Actions trees and active-project tasks, used to recognize follow-ups you already track

## Process

### Step 1: Load the watermark

Read `Metadata > ⚙️ Scanner State > meeting-followup-reviewer` (single child holds one JSON line). See `${CLAUDE_PLUGIN_ROOT}/skills/otter-deduplication.md` for the scanner-state pattern.

```bash
./bin/run.js node search --query "meeting-followup-reviewer" --limit 1 --json
```

If found, read its child:

```bash
./bin/run.js node get --id <node-id> --depth 1 --json --fields name,shortId,children
```

The child node name is a JSON line such as `{"last_reviewed_iso":"2026-05-06T00:00:00Z"}`. Parse `last_reviewed_iso` as the watermark.

**If the node is absent**, default the watermark to **7 days ago** (today minus 7 days, at `00:00:00Z`). Create the node lazily later in Step 10 — do not create it here.

### Step 2: Load VIPs

`people.json` is large (40k+ lines). Do **not** read it whole — extract just the VIPs with `jq`:

```bash
jq -c '[.. | objects
  | select(.name? and (.name|type=="string") and (.name|startswith("@")))
  | select(.children? and (.children|type=="array") and any(.children[];
      .name? and (.name|type=="string") and (.name|test("Relationship: (Direct Manager|Manager.s Manager)"))))
  | {name, shortId}]' .llm/gtd/metadata/people.json
```

- This returns the manager/manager's-manager `@`-handles (substring match tolerates HTML/whitespace). They get extra weight in Step 6.
- If the list is empty, continue — the review still surfaces follow-ups assigned to the user.

### Step 3: Find recent meetings

Read meeting entries under `📆 Calendar` dated on or after the watermark:

```bash
./bin/run.js node get --path "📆 Calendar" --depth 2 --json --fields name,shortId,children,modifiedAt
```

Otter meeting entries are tagged `#meeting` and have an `otter.ai/u/<otid>` child link. Keep only children that:

- Are tagged `#meeting`
- Have a `<time>` element whose date is on or before today **and** on or after the watermark date

**Date comparison:** parse the `<time>` element's start date and compare as ISO date strings (`"2026-05-06" <= "2026-05-20"`), not as JS `Date` objects.

If no meetings fall in the window, report "No new meetings since last review" and skip to Step 10 to advance the watermark.

### Step 4: Read meeting contents

For each in-window meeting, read its children:

```bash
./bin/run.js node get --id <meeting-id> --depth 3 --json --fields name,shortId,children
```

Focus on:

- `<b>Action Items</b>` child and its descendants
- `<b>Summary</b>` / outline child and its descendants

### Step 5: Load project context for grounding

Read active project titles so the LLM can ground its judgments against real work:

```bash
./bin/run.js node get --path "Work,🎯 Projects" --depth 2 --json --fields name,shortId,children
./bin/run.js node get --path "Personal,🎯 Projects" --depth 2 --json --fields name,shortId,children
```

Summarize to a small list of project names plus a few recent task titles each — enough to recognize which transcript fragments are real follow-ups versus noise.

### Step 6: LLM judgment pass

For each meeting, assemble candidate follow-ups. A candidate is:

- An **action item** whose assignee resolves — fuzzily, since names are misheard — to the user
- An **action item** in a meeting where a VIP attended, even if assigned to someone else (the user may still need to track it)
- A **summary or outline sentence** that names the user, OR sounds like a VIP ask, judged plausible against the project context from Step 5

When a transcript fragment is ambiguous because of misheard text, prefer to surface it rather than drop it silently — the user confirms in Step 8.

For each candidate, record: a clean one-line description, the source meeting name, the meeting's Workflowy link, and a short reason ("@DirectManager asked for X", "action item assigned to you", etc.).

### Step 7: Match candidates against existing tasks

A follow-up the user already tracks is not a new inbox item — it is context for the task that already exists. Load the same open-task snapshot the capture flow uses for duplicate detection:

```bash
mkdir -p .llm/gtd/review/meetings
${CLAUDE_PLUGIN_ROOT}/scripts/load-existing-tasks.sh > .llm/gtd/review/meetings/existing-tasks.json
```

The script reads the synced metadata cache and emits `nextActions` (both Next Actions trees) and `projectTasks` (active projects, each entry carrying `projectName`). Every entry has `id` and `name`.

**If the script fails** (usually `metadata directory not found`), run the `gtd:metadata-sync` subagent once and retry. If it still fails, continue the review with no matches — and say so in every Step 8 question rather than implying nothing matched.

Match each Step 6 candidate against both arrays. Normalize both sides first: lowercase, strip HTML, `#tags`, `@mentions`, and punctuation. Then look for:

- A substring match in either direction
- More than ~70% overlap of significant words, ignoring stopwords and generic verbs (`do`, `check`, `look at`)
- The same distinctive noun phrase even when the verbs differ — "reduce usages of deprecated java code" matches "deprecated Java cleanup in the monorepo"

Otter text is misheard, so match on the distinctive nouns rather than the phrasing, and prefer reporting a weak match over reporting none — the user judges it in Step 8.

Record on each candidate either `existingMatch: null` or a single best match `{id, name, source: "nextActions" | "projectTasks", projectName}` plus a one-line reason for the match. Never drop a candidate just because it matched.

### Step 8: Confirm each candidate

Present candidates one at a time using AskUserQuestion. The user does not read the scrolling console, so everything needed to decide goes **inside** the question body: the description, the source meeting (as a clickable link), the Step 6 reasoning, and the Step 7 match result.

State the match result explicitly on every question — never omit it:

- **Matched:** the existing task's name and where it lives (`Work > ☑️ Next (Work)`, or the `projectName`)
- **No existing task matched.**
- **Existing-task check unavailable** — only when the Step 7 script failed

Offer **three** options:

- **Add to inbox** — create a new inbox node in Step 9
- **File on existing task** — add the meeting as context under the matched task in Step 9 instead of creating a duplicate inbox item. Offer this option only when Step 7 found a match, and name the matched task in the option label so it is identifiable.
- **Skip** — drop it (whether it's noise, not the user's, or a real follow-up that's already done — all three drop the same way; this command records nothing on skip, so there's no behavioral difference and no reason to split "skip" from "already handled")

- Batch into multiple questions per AskUserQuestion call if needed.
- Never auto-add — every item needs explicit confirmation, including the "file on existing task" path.

### Step 9: Record confirmed items

#### Branch A — Add to inbox

Create a node under `Inbox`:

```bash
./bin/run.js node create --parent-id <inbox-id> --name "<enriched follow-up description>"
```

**Enrich the description while you still have the meeting fresh in context — get ahead of refinement.** You just read the transcript, so you know things the later `/gtd:inbox` refinement would have to re-derive from a bare title. Fold whatever you can infer into the node name (and pick the right inbox — Work vs Personal — for the item):

- **@people** the item involves (resolve to canonical @mentions), e.g. `@Alice`, `@Bob`.
- **Work vs personal** context — a `#work`/`#personal` tag, and file it under the matching Inbox.
- **A due date** if the meeting implied one (`<time>` element per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`), or a soft-urgency note if it's event-driven but undated.
- Any concrete specifics the transcript gave (names, amounts, deliverable details) so the item reads on its own.

Keep it a single actionable line; put longer context in provenance children below. Don't invent facts the meeting didn't contain — enrich only from what was actually said.

Add the provenance — meeting link and brief source context — as **child nodes**, never as a Workflowy note (see CLAUDE.local.md):

```bash
./bin/run.js node create --parent-id <new-inbox-node-id> --name 'From: <a href="https://otter.ai/u/<otid>">Meeting name</a> <time>...</time>'
```

This mirrors the inbox-creation pattern in the `capture-executor` agent.

#### Branch B — File on the existing task

Add the meeting as a child of the task the candidate matched in Step 7:

```bash
./bin/run.js node create --parent-id <existing-task-id> --name 'From: <a href="https://otter.ai/u/<otid>">Meeting name</a> <time>...</time> — <one line of what the meeting added>'
```

- Do **not** also create an inbox node — avoiding the duplicate is the entire point of this branch.
- Do **not** rename, re-tag, or re-date the existing task; the meeting is context, not a rewrite.
- Keep the context line to what the transcript actually said (a new deadline, a new asker, a changed scope).

### Step 10: Advance the watermark

Update the scanner-state node `Metadata > ⚙️ Scanner State > meeting-followup-reviewer` to the current ISO timestamp.

**If the node exists**, update its single JSON child:

```bash
./bin/run.js node update --id <child-node-id> --name '{"last_reviewed_iso":"<now-iso>"}'
```

**If the node was absent in Step 1**, create it lazily now:

```bash
./bin/run.js node create --parent-path "Metadata,⚙️ Scanner State" --name "meeting-followup-reviewer"
./bin/run.js node create --parent-id <new-node-id> --name '{"last_reviewed_iso":"<now-iso>"}'
```

## Output

Report a brief summary:

```text
🤝 Meeting Follow-up Review
Meetings reviewed: 4 (since 2026-05-06)
Candidates found: 6
Matched an existing task: 2
Confirmed to inbox: 3
Filed on an existing task: 1
Skipped / already handled: 2
```

If the inbox grew meaningfully, suggest running `/gtd:inbox` to process the new items.

## Notes

- This review only reads Workflowy entries that Otter has already journaled — it never calls the Otter API directly.
- Confirmed items land in `Inbox` raw; `/gtd:inbox` handles refinement and project assignment.
- Items filed on an existing task never reach the Inbox, so `/gtd:inbox` never sees them — that is intended.
