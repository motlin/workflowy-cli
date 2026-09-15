---
description: Walk Otter-ingested meetings since the last review, flag probable follow-ups (weighting asks from your manager and skip-level), confirm each with you, and drop accepted items into the Inbox or, when you already did them, journal them to the work calendar for the meeting date. Use when the user wants to review recent meetings, catch up on meeting follow-ups, or extract action items from meeting transcripts.
---

# Meeting Follow-up Review

Walk recent Otter-ingested meetings since the last review and capture probable follow-ups to the Inbox. A follow-up the user already did is journaled to `Work > 📅 Calendar` under the meeting date instead.

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
- **People roster** — canonical names and explicit aliases from `.llm/gtd/metadata/people.json`; the VIP subset alone is insufficient for spelling checks
- **VIP list** — direct manager(s) and manager's manager(s) from that roster
- **Known product names** — a local, evidence-backed list assembled from synced project metadata and user-confirmed spellings as described in Step 6
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

The child node name is a JSON line such as `{"last_reviewed_iso":"2026-05-06T00:00:00Z"}`. Parse `last_reviewed_iso` as an instant, retaining its time, seconds, and UTC offset. Reject an invalid timestamp or one without a timezone; do not truncate it to a date.

Capture `review_started_iso` as the current UTC ISO timestamp before reading meetings. This is the inclusive upper bound for this review and the watermark saved in Step 10, so time spent reviewing cannot move the cutoff past meetings not yet scanned.

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

Read meeting entries under `📆 Calendar` whose start instant is after the watermark and at or before `review_started_iso`:

```bash
./bin/run.js node get --path "📆 Calendar" --depth 2 --json --fields name,shortId,children,modifiedAt
```

Otter meeting entries are tagged `#meeting` and have an `otter.ai/u/<otid>` child link. Keep only children that:

- Are tagged `#meeting`
- Have an Otter link identifying the source meeting
- Have a `<time>` element whose full start datetime satisfies `watermark < meeting_start <= review_started_iso`

**Timestamp comparison:** read `startYear`, `startMonth`, `startDay`, `startHour`, and `startMinute` from the `<time>` element. When the time attributes are absent, parse the explicit time in its displayed text (for example, `at 10:32am`), including correct noon/midnight conversion. Preserve the calendar date separately for Step 9 journaling. Compare numeric instants after timezone conversion, never ISO date strings or timezone-free strings passed to `new Date()`.

The Workflowy date components do not themselves identify a timezone. Resolve the timezone used when that entry was ingested from explicit ingestion configuration or retained source data; use that zone's offset on the meeting date, including daylight saving time. Do not assume the current machine timezone, today's offset, or UTC. A retained source Unix timestamp or timestamp with an explicit offset can establish the instant directly. If the time or timezone is unavailable, invalid, or ambiguous during a daylight-saving transition, stop and report the affected meeting before proposing candidates or advancing the watermark; do not silently treat it as midnight or skip it.

For example, with a watermark of `2026-05-06T15:00:00Z` and a verified `America/New_York` ingestion timezone, a 10:32am meeting that day is `14:32:00Z` and is excluded; an 11:30am meeting is `15:30:00Z` and is included if the review started at or after that instant. A meeting exactly at the watermark is excluded.

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

#### Resolve names before matching tasks

Check **every proper noun** in each candidate, including the assignee, other people, products, project references, and the short reason. Do this before Step 7 so a misheard name does not hide an existing task.

- Use the full people roster, not just the Step 2 VIPs. Extract only names, node IDs, and relevant explicitly recorded aliases with `jq`; never load the whole `people.json` into context. Follow `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md` for full-name-plus-context matching and canonical `@mentions`. A first-name resemblance alone does not establish identity.
- Build a small known-product-name list locally in `.llm/gtd/review/meetings/known-product-names.json`. Use explicit product spellings in `.llm/gtd/metadata/projects/*.json`, grounded by the Step 5 project context, and spellings the user has confirmed. Retain each canonical spelling, any explicit aliases, and its evidence (metadata file and node ID, or the user's confirmation). A project title is context, not automatically a product name. There is no assumed `products.json` registry: when the evidence does not identify a product, leave it unresolved. Do not edit synced metadata or commit this private working list.
- Compare case, spacing, punctuation, explicit aliases, and plausible transcription near-misses against those sources. Exact supported matches may use the canonical spelling in the proposed description. Phonetic similarity and edit distance only suggest a correction; they never authorize one. If a roster or product source is missing or stale, report that limitation in Step 8 and keep the affected names unresolved rather than inventing spellings.
- Record a local per-candidate name resolution for each proper noun: the original text, proposed canonical form (if any), evidence, and status (`exact`, `proposed`, `ambiguous`, or `unresolved`). Preserve the original transcript separately. Never overwrite a quotation to make it look as though Otter transcribed the corrected form.
- Carry both original and proposed spellings into Step 7 matching. An ambiguous person or product must not create a confident task match or VIP attribution; disclose the uncertainty with any suggested match.

For each candidate, record: a proposed clean one-line description, the source meeting name, the meeting's Workflowy link, a short reason ("@DirectManager asked for X", "action item assigned to you", etc.), and the name resolutions above.

Also retain whether the source explicitly assigns the action to a named person, with the supporting transcript fragment. This includes assignments to someone other than the user. Attendance, a person mentioned in discussion, and an inferred VIP ask are not explicit assignments. Preserve this flag per source when merging candidates; an explicit assignment with an unresolved name still counts as name-assigned.

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

Before starting Step 8, compare candidates against each other across **all meetings in this run**, using the same normalization and distinctive noun-phrase rules above. Group candidates describing the same action into one merged candidate, even when their source meetings differ. Retain every source meeting's name, link, date, transcript context, reason, and name resolutions; combine distinct details without inventing agreement where the sources conflict. Match the merged candidate against existing tasks as well. A shared person, product, or broad topic alone is not enough to combine different actions. Surface weak matches and conflicting scope or unresolved identities for the user's decision instead of silently collapsing them.

Present each merged candidate once, naming and linking **all source meetings** in its Step 8 question. Explain the shared action and any differences that need confirmation, so the user can accept one task or separate distinct actions. Candidate-to-candidate matching still works when the existing-task snapshot is unavailable; disclose that separate limitation. Grouping is a proposal, not acceptance or a verified filing destination.

### Step 8: Confirm each candidate

Keep a local per-candidate outcome ledger in `.llm/gtd/review/meetings/`: `pending`, `skipped`, `accepted_pending_write`, `added`, `filed`, `journaled`, or `failed`. Record the user's decision and, after recording succeeds, the verified destination node ID and name. A proposed title or acceptance alone is not a destination.

#### Choose how to review unassigned meetings

Before walking individual candidates, offer one meeting-level question for each meeting with candidates but **no explicitly name-assigned candidate** from Step 6. Determine this from all of that meeting's original candidates, before merging or skipping anything. Meetings with any name-assigned candidate go directly to the per-item walk. Meetings with no candidates need no question.

Put the meeting name and clickable link, every candidate description, reasoning, name-resolution evidence or uncertainty, and current match result inside the question body. For shared candidates, show all source meetings and identify which contributions belong to this meeting. Offer exactly:

- **Skip the whole meeting** — skip this meeting's candidate contributions without creating or filing anything. Shared actions remain pending when another source meeting still contributes them; identify those actions in the question so skipping never implies they were dropped everywhere.
- **Walk them one at a time** — continue with the individual confirmation questions below. This does not accept any candidate or authorize a write.

Record each meeting choice and each skipped source contribution in the local ledger, retaining the original provenance for audit. Set a merged candidate to `skipped` only when all its source contributions have been skipped; otherwise retain it as `pending` and refresh its description, name resolutions, and match from its remaining sources. Never skip another meeting's assignment or change an already recorded outcome. A skipped source is excluded from later recording, and is not a task destination. Resolve these meeting choices before the per-item walk; interruption or an unanswered choice prevents watermark advancement.

#### Confirm individual candidates

Before each question (including a meeting-level question), refresh each displayed candidate's match against pre-existing tasks and earlier follow-ups successfully recorded in this walk. Only `added` and `filed` outcomes contribute task destinations: an added follow-up contributes its created inbox node; a filed follow-up contributes the existing task it was filed on, never its provenance child. Exclude `pending`, `skipped`, `accepted_pending_write`, `journaled`, and `failed` candidates from filing and merge targets, including candidates from the same meeting. A skipped candidate does not invalidate an independently verified pre-existing task on the same topic. Verify the target node still exists before offering it, and show its actual name and location in the question.

Present candidates one at a time using AskUserQuestion. The user does not read the scrolling console, so everything needed to decide goes **inside** the question body: the description, the source meeting (as a clickable link), the Step 6 reasoning, and the Step 7 match result.

Include the name-resolution results **inside the same question body**, next to the proposed description. For each near-miss show the original, suggestion, and evidence inline, for example: `“Git Hub” — did you mean “GitHub” (project metadata)?` Show unresolved names and competing matches explicitly; do not hide them in console output. If all names matched exactly, say so; if a source was unavailable, state which check could not be performed.

Make clear that accepting the displayed description also confirms its explicitly proposed spellings. When a name is ambiguous or unresolved, obtain the user's chosen spelling (or explicit instruction to retain the original) before recording; a destination choice alone does not resolve an unspecified identity. Update the local name resolutions with that decision. If a correction changes the apparent task match, refresh Step 7 and confirm the resulting destination before writing. The user may reject a suggested spelling without having to skip the follow-up.

State the match result explicitly on every question — never omit it:

- **Matched:** the existing task's name and where it lives (`Work > ☑️ Next (Work)`, or the `projectName`)
- **No existing task matched.**
- **Existing-task check unavailable** — only when the Step 7 script failed

Offer these options, omitting filing when no eligible target exists:

- **Add to inbox** — create a new inbox node in Step 9
- **File on existing task** — add the meeting as context under an eligible matched task in Step 9 instead of creating a duplicate inbox item. Name the verified task in the option label so it is identifiable.
    - An earlier follow-up from **any meeting in this walk** can be a match when its outcome is `added` or `filed` and its task destination is verified. Use the Step 7 normalized noun-phrase rules across meeting boundaries. Shared meeting context is a matching hint, never proof that a task exists or that the user accepted it.
- **Already did it — journal it** — the user completed the follow-up between the meeting and now. Step 9 writes it as a journal entry to `Work > 📅 Calendar` under the **meeting date**, never to the Inbox. Name the calendar in the option label (e.g. `Already did it — journal to Work > 📅 Calendar`) so the destination is visible before the user confirms.
- **Skip** — drop it, whether it's noise or not the user's. This command records nothing on skip. Already-done is split out from Skip because it has a different **destination** (a dated calendar entry), not merely a different label — a skipped item leaves no trace, a done item becomes journal.

- Resolve each candidate's decision and Step 9 recording before preparing the next question. On Skip, set `skipped` locally without writing a Workflowy node. On acceptance, set `accepted_pending_write`; after a successful write, read back the destination and record `added`, `filed`, or `journaled`. On a write or verification failure, set `failed` and stop without advancing the watermark.
- Never auto-add — every item needs explicit confirmation, including the "file on existing task" path.

### Step 9: Record confirmed items

Use the Step 8 confirmed spellings consistently in every newly written title, reason, paraphrased context, and journal entry across all branches. Resolve person mentions only to the confirmed roster identity. Do not introduce new name corrections during enrichment. Keep literal source quotations unchanged and label any correction separately; do not rename the source meeting or an existing task. Read back the written text as part of outcome verification to check that it contains the agreed spellings. An accepted follow-up with pending name decisions remains unresolved and prevents Step 10 from advancing the watermark; a skipped candidate needs no spelling decision.

For a confirmed merged candidate, create or file **one task** with provenance children for every non-skipped source meeting and each distinct supporting point. Keep each source's date and link attached to its context. If the user chooses journaling and the remaining source meetings have different dates, confirm which source meeting date to use in Step 8 and write one journal entry with all non-skipped source provenance. Track the merged decision and verified destination for every contributing candidate in the local ledger, preserving skipped source outcomes; none should be proposed or written again separately. Only mark the group recorded after all its required writes and read-back verification succeed.

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

Alongside the provenance child, add **one child bullet per distinct point the user said out loud** about the item in the transcript — the mission, the scope, constraints, deadlines, who is involved. Quote or closely paraphrase what was actually said; these children exist so the item carries the user's own framing into refinement instead of a bare title:

```bash
./bin/run.js node create --parent-id <new-inbox-node-id> --name 'Mission: "<what the user said the item is for>"'
./bin/run.js node create --parent-id <new-inbox-node-id> --name 'Scope: "<what the user said is in or out>"'
./bin/run.js node create --parent-id <new-inbox-node-id> --name 'Deadline: "<what the user said about timing>"'
```

- One point per child — don't merge mission and scope into a single bullet, and don't add a child for a point the user didn't make.
- The no-inventing rule applies here as much as to the title: if the transcript has only a one-line ask, the provenance child is the only child.

#### Branch B — File on the existing task

Add the meeting as a child of the verified task offered and selected in Step 8, whether it was a pre-existing task or an earlier recorded follow-up. Recheck eligibility and existence before writing; if the selected destination is no longer valid, explain and ask for a new destination rather than substituting another task:

```bash
./bin/run.js node create --parent-id <existing-task-id> --name 'From: <a href="https://otter.ai/u/<otid>">Meeting name</a> <time>...</time> — <one line of what the meeting added>'
```

- Do **not** also create an inbox node — avoiding the duplicate is the entire point of this branch.
- Do **not** rename, re-tag, or re-date the existing task; the meeting is context, not a rewrite.
- Keep the context line to what the transcript actually said (a new deadline, a new asker, a changed scope).
- When the user said more than one distinct thing about the task — mission, scope, constraints, deadlines — add each as its own child of the existing task next to the provenance child, quoted or closely paraphrased, exactly as in Branch A. Same rule: no child for a point the user didn't make.

#### Branch C — Already did it: journal it

A finished follow-up is a journal entry, not a task. Write it to the calendar under the **meeting date** — the date on the meeting's `<time>` element from Step 3 — not today's date.

**Which calendar.** There are three, and they are not interchangeable:

- `📆 Calendar` (root level) — the native Workflowy calendar feature, where Otter journals meetings. Never write follow-ups here.
- `Personal > 📅 Calendar` — the personal journal. Day nodes sit directly under it.
- `Work > 📅 Calendar` — the work journal. Day nodes sit under its `📍 Current` child.

Meeting follow-ups are work, so default to `Work > 📅 Calendar`. Use `Personal > 📅 Calendar` only when the meeting itself was clearly personal, and say so in the Step 8 option label.

Find the day node for the meeting date:

```bash
./bin/run.js node get --path "Work,📅 Calendar,📍 Current" --depth 1 --json --fields name,shortId,children
```

Match the child whose `<time>` element carries the meeting's `startYear`, `startMonth`, and `startDay`. If no child matches, create the day node — compute the `<time>` element with `date` per `${CLAUDE_PLUGIN_ROOT}/skills/review-date-updates.md`, never hand-type the weekday:

```bash
ISO=<meeting date as YYYY-MM-DD>
TIME_EL=$(printf '<time startYear="%s" startMonth="%s" startDay="%s">%s</time>' \
  "$(date -j -f %Y-%m-%d "$ISO" +%Y)" "$(date -j -f %Y-%m-%d "$ISO" +%-m)" \
  "$(date -j -f %Y-%m-%d "$ISO" +%-d)" "$(date -j -f %Y-%m-%d "$ISO" '+%a, %b %-d, %Y')")
./bin/run.js node create --parent-path "Work,📅 Calendar,📍 Current" --name "$TIME_EL"
```

Then add the entry under the day node, with the meeting as a provenance child:

```bash
./bin/run.js node create --parent-id <day-node-id> --position bottom --name '✅ <past-tense description of what was done>'
./bin/run.js node create --parent-id <new-entry-id> --name 'From: <a href="https://otter.ai/u/<otid>">Meeting name</a>'
```

- Write the entry in past tense so it reads as journal next to its neighbors, and make it standalone — name the deliverable, the @people involved, and any concrete specifics the transcript gave, exactly as the Branch A enrichment rules require.
- Do **not** also create an inbox node or a child on an existing task — the work is done, so nothing needs tracking.
- Do **not** write the entry under `📆 Calendar`, even though the meeting itself lives there: that calendar is Otter's, and the follow-up is the user's journal.

### Step 10: Advance the watermark

After all in-window meetings and their candidate decisions have been handled, update the scanner-state node `Metadata > ⚙️ Scanner State > meeting-followup-reviewer` to `review_started_iso` captured in Step 1. Use this same value for an empty window. Do not advance it after an interrupted review, unresolved meeting datetime, or failed recording operation.

**If the node exists**, update its single JSON child:

```bash
./bin/run.js node update --id <child-node-id> --name '{"last_reviewed_iso":"<review-started-iso>"}'
```

**If the node was absent in Step 1**, create it lazily now:

```bash
./bin/run.js node create --parent-path "Metadata,⚙️ Scanner State" --name "meeting-followup-reviewer"
./bin/run.js node create --parent-id <new-node-id> --name '{"last_reviewed_iso":"<review-started-iso>"}'
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
Journaled as already done: 1
Skipped: 1
```

If the inbox grew meaningfully, suggest running `/gtd:inbox` to process the new items.

## Notes

- This review only reads Workflowy entries that Otter has already journaled — it never calls the Otter API directly.
- Confirmed items land in `Inbox` raw; `/gtd:inbox` handles refinement and project assignment.
- Items filed on an existing task never reach the Inbox, so `/gtd:inbox` never sees them — that is intended.
- Already-done items go to `Work > 📅 Calendar` under the meeting date, never to the root `📆 Calendar` (Otter's) or the Inbox.
