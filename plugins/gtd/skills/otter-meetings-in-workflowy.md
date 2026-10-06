---
description: Find what was said in Otter.ai meetings using the copies already in Workflowy — meeting nodes under 📆 Calendar (Overview, Action Items, Outline) and task provenance lines ("From: <meeting> (https://otter.ai/u/<otid>)"). Use when researching what someone asked for across meetings, gathering context for a doc or task, or collecting the Otter IDs to pull full transcripts with the otter-transcripts skill.
---

# Otter Meetings in Workflowy

Otter meetings are journaled into Workflowy by the daily review. Search Workflowy first: it is fast, offline, and already summarized. Fall back to full transcripts (the `otter-transcripts` skill) only when the summary is too thin.

## Refresh the cache

Before searching, refresh the cache so recently ingested meetings are present: `./bin/run.js cache import-api`

## Where meetings live

- **Meeting nodes**: `📆 Calendar > YYYY > MM > <date> > "<date> at <time> <title> (https://otter.ai/u/<otid>) #meeting"`, with children:
    - `otter.ai/u/<otid>`
    - `Overview` — Otter's short summary
    - `Action Items` — each with `(@Assignee)`
    - `Outline` — topic headings with summarized bullets; the richest source short of the transcript
- **Task provenance**: tasks captured from meetings carry child lines such as `From: 1:1 Alice (https://otter.ai/u/<otid>) <date> — <what was asked>`. These show which meetings produced which asks, and are often more precise than Otter's own summary because they were reviewed by the user.
- **Older meetings** (before the 📆 Calendar system) may sit under `Work > 📅 Calendar > 🗃️ Archive`.

## Search patterns

- A recurring meeting series: `./bin/run.js node search -q "1:1 Alice" -l 50`, then keep the `#meeting` results.
- A topic across all meetings: `./bin/run.js node search -q "<keyword>" -l 50` — hits inside `Outline` / `Action Items` show the meeting in their breadcrumb.
- A person's asks: search their `@Mention` plus a topic keyword; check both meeting nodes and task provenance.
- One meeting's content: `./bin/run.js node get --id <meeting node id> --depth 4`.
- For bulk work, dump a subtree to the scratchpad and grep it there instead of re-querying.

Search results are substring matches on names and notes. Try synonyms and transcription variants: Otter often misspells names (the same person can show up under two spellings).

## Collect the evidence

For each relevant meeting, record date, title, otid, and the specific asks, quoted where possible. Keep the otid. It is the key for pulling the full transcript.

## When to escalate to the transcript

Pull the full transcript when:

- The summary names an ask but not its details (scope, deadline, who decides)
- The user's wording matters (a request to quote someone, or a request whose exact framing is in dispute)
- The Outline is missing or empty
- A meeting is referenced by otid in a task but has no meeting node
