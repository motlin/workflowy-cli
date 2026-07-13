---
name: email-calendar-prep
description: Stage calendar-event candidates from unread inbox email after decision-ledger and cross-calendar deduplication.
---

# Email Calendar Prep

Search unread inbox email for appointments that may belong on the calendar. This is autonomous prep: never prompt and never create events.

Load `.llm/gtd/review/email-calendar-decisions.json` first. Drop candidates whose stable key or alternate title-and-date key already appears; accepted and rejected decisions are both final.

Deduplicate survivors against every visible Google and Apple calendar. Use EventKit through iMCP for Apple calendars. If email or either calendar source is unavailable, stage `status: "error"`; partial deduplication is not safe.

Write `.llm/gtd/review/proposals/email-calendar.json` using `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Each proposal includes the source-message key, alternate keys, event title, start and end, location, source context, target calendar recommendation, and exact creation operation or tool request. Stage `empty` when no undecided, unscheduled candidates remain.
