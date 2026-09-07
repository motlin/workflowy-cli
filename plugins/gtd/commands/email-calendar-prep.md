---
name: email-calendar-prep
description: Stage calendar-event candidates from unread inbox email after decision-ledger and cross-calendar deduplication.
---

# Email Calendar Prep

Search unread inbox email for appointments that may belong on the calendar. This is autonomous prep: never prompt and never create events.

Load `.llm/gtd/review/email-calendar-decisions.json` first. Drop candidates whose stable key or alternate title-and-date key already appears; accepted and rejected decisions are both final.

Deduplicate survivors against every visible Google and Apple calendar. Use EventKit through iMCP for Apple calendars.

## Stop if a source is unavailable

Check all three sources — unread email, Google Calendar, Apple/iCloud Calendar via iMCP — **before** scanning. If any one of them is unavailable, **stop immediately**: stage the error below, write nothing else, and return. Do not scan email, do not deduplicate against the sources that do work, and do not stage proposals.

`iMCP.app` being in `ps` output does **not** mean iMCP works. The only thing that counts is whether the iMCP tools are registered in this session. A `helper-absent` result, a missing `mcp__*` tool, or a timeout all mean unavailable.

When this task runs as a daily-review prep controller, it runs in a **subagent**, and a subagent's tool registry is fixed at session startup. Relaunching `iMCP.app` does nothing, and neither does the user running `/mcp` mid-session — that reaches the main thread only. Recovery requires `/mcp` **and a session restart**; redispatching this task in the same session will fail identically. Say so in the staged error instead of asking for a retry that cannot work. The daily-review import barrier (`daily-import.md`) preflights this so the failure surfaces before fan-out.

Partial deduplication is worse than no run at all: an event already sitting on the unreachable calendar gets re-proposed every single review, and each rejection has to be re-entered by hand. A skipped task simply retries tomorrow. Never trade that away for a report that looks more actionable.

```json
{
	"task": "email-calendar",
	"generatedAt": "<now, ISO-8601 with offset>",
	"status": "error",
	"presentation": "Scan email for events",
	"error": "<source> unavailable: <what failed>. User must run /mcp and reconnect, then re-run this task.",
	"proposals": []
}
```

Write `.llm/gtd/review/proposals/email-calendar.json` using `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Each proposal includes the ledger identity, event title, start and end, location, source context, target calendar recommendation, and exact creation operation or tool request. Stage `empty` when no undecided, unscheduled candidates remain.

## Ledger identity fields

The stable identity is staged as `key` and the alternates as `altKeys` — the exact field names the decisions ledger and `email-calendar-apply` read. Apply copies `.key` and `.altKeys` straight from the proposal into `.llm/gtd/review/email-calendar-decisions.json`, so any other name (an earlier run staged `sourceKey`) produces a `"key": null` ledger row that suppresses nothing, and the same email is re-proposed every review with no visible error.

```json
{
	"header": "Sep 25",
	"key": "<account>-imap-uid-<uid>",
	"altKeys": ["<event title> | <yyyy-mm-dd>", "<subject> | <sender address>"],
	"messageUid": 12345
}
```

Derive `key` from the source message (`<account>-imap-uid-<uid>`, suffixed with the event date when one email yields several events). `altKeys` carry the title-and-date and subject-and-sender forms so a forwarded or re-sent copy still matches. After writing the file, run the validator; it rejects any `email-calendar` proposal whose `key` is missing, null, blank, or staged under another name:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-proposal.mjs .llm/gtd/review/proposals/email-calendar.json
```
