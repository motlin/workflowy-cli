---
name: email-calendar-apply
description: Confirm staged email-derived calendar candidates, create accepted events, and persist every accept or reject decision.
---

# Email Calendar Apply

Read `.llm/gtd/review/proposals/email-calendar.json` and follow the shared apply routine.

Present each ready candidate with its source, proposed event details, and target calendar. Offer four options per candidate:

- **Accept** — create the event and verify it exists.
- **Accept with note** — create the event with the user's edits applied, then verify it exists.
- **Reject** — create nothing and keep the email. Use this for mail worth keeping.
- **Reject and delete** — create nothing, record the decision exactly like **Reject** (`decision: "reject"`, with `detail` noting the email is being trashed), then trash the source message.

To trash on **Reject and delete**, use the staged `account`, `mailbox`, `messageUid`, and `uidValidity` directly; never search for the email. Move it to Trash with `mcp__gmail-<account>-imap__move_message` (`mailbox`, `uid: messageUid`, `uidValidity` when staged, `targetMailbox: "[Gmail]/Trash"`), which keeps it recoverable, rather than `delete_message`, which expunges permanently. Verify by calling `mcp__gmail-<account>-imap__get_message` on the original mailbox and UID with `markSeen: false`: the message must be gone. A partial or unknown move outcome, or a message still present, is a trash failure: report it inline (`⚠️ rejected <header> — email not trashed: <reason>`) and keep the reject recorded; recording before trashing means a trash failure never re-proposes the email.

Append every verified accept and explicit reject to `.llm/gtd/review/email-calendar-decisions.json` as `{key, altKeys, decision, date, detail}` so the email is never proposed again. `key` and `altKeys` come verbatim from the proposal's `key` and `altKeys` fields; never write a ledger row whose `key` is null. If a proposal has no `key`, treat it as a prep bug and return failure instead of recording the decision — run the validator on the staged file to see which proposal is malformed.

Return empty without prompting when prep staged `empty`. Return failure on missing calendar tools, a missing IMAP MCP server for a **Reject and delete** answer, event-creation failure, verification failure, or ledger-write failure. Return success only after every decision is applied and recorded. The DAG executor owns scheduling.
