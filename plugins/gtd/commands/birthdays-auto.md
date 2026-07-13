---
name: birthdays-auto
description: Build the daily birthday and anniversary briefing from Workflowy people metadata without prompting.
---

# Birthdays Auto

Read people under `Metadata > 👥 People` and match birthday or anniversary fields by month and day only.

The year stored in the next-occurrence field is not the event year. Calculate age from the companion `👶 Date of birth` field and years married from `💒 Married on`. If the companion field is absent, omit the count rather than guessing.

Write `.llm/gtd/review/briefings/birthdays.json` using the briefing schema in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`. Stage `empty` with a “none today” line when no event matches. Return verified success or empty; return failure on unreadable or malformed source data. Never prompt or update the task date.
