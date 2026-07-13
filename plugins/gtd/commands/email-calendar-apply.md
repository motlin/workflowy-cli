---
name: email-calendar-apply
description: Confirm staged email-derived calendar candidates, create accepted events, and persist every accept or reject decision.
---

# Email Calendar Apply

Read `.llm/gtd/review/proposals/email-calendar.json` and follow the shared apply routine.

Present each ready candidate with its source, proposed event details, and target calendar. On accept, create the event and verify it exists. On reject, create nothing. Append every verified accept and explicit reject to `.llm/gtd/review/email-calendar-decisions.json` with stable key, alternate keys, decision, date, and detail so the email is never proposed again.

Return empty without prompting when prep staged `empty`. Return failure on missing calendar tools, event-creation failure, verification failure, or ledger-write failure. Return success only after every decision is applied and recorded. The DAG executor owns scheduling.
