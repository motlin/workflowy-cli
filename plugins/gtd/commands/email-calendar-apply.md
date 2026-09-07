---
name: email-calendar-apply
description: Confirm staged email-derived calendar candidates, create accepted events, and persist every accept or reject decision.
---

# Email Calendar Apply

Read `.llm/gtd/review/proposals/email-calendar.json` and follow the shared apply routine.

Present each ready candidate with its source, proposed event details, and target calendar. On accept, create the event and verify it exists. On reject, create nothing. Append every verified accept and explicit reject to `.llm/gtd/review/email-calendar-decisions.json` as `{key, altKeys, decision, date, detail}` so the email is never proposed again. `key` and `altKeys` come verbatim from the proposal's `key` and `altKeys` fields; never write a ledger row whose `key` is null. If a proposal has no `key`, treat it as a prep bug and return failure instead of recording the decision — run the validator on the staged file to see which proposal is malformed.

Return empty without prompting when prep staged `empty`. Return failure on missing calendar tools, event-creation failure, verification failure, or ledger-write failure. Return success only after every decision is applied and recorded. The DAG executor owns scheduling.
