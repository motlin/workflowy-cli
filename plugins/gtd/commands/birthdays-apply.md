---
name: birthdays-apply
description: Announce today's birthdays and anniversaries prominently, then walk every relationship date from the last year that still needs handling, one at a time.
---

# Birthdays — Apply

The interactive half of the birthdays split. Reads what `/gtd:birthdays-prep` staged at `.llm/gtd/review/proposals/birthdays.json`.

## Prerequisite and freshness

Run `/gtd:birthdays-prep` first; in the daily review it runs automatically as a Phase 0 prep subagent.

**Check `generatedFor` against today's date before presenting anything.** A long review can cross midnight, and a briefing computed for yesterday will announce yesterday's events and stay silent about today's. If they differ, re-run the prep for the current day and use the fresh result. This is not optional — it is exactly how an anniversary passed unannounced on 2026-08-20 during a review that started on the 19th.

## Announce today first

Before any walking, print the `today` array **on its own, at the top, in full**:

```text
🎂 TODAY — @Alice turns 40
💍 TODAY — @Bob and @Carol's 3rd anniversary (married Aug 20, 2023)
```

Say who they are from the `👥 Relationship:` field when it is close family — "your sister" carries weight that a bare `@mention` does not. Never fold a TODAY line into a paragraph, a table row, or the tail of a longer summary. If `today` is empty, say so in one line and move on.

Then print `upcoming` as clearly-dated heads-up lines, visibly separate from the TODAY block.

## Walk the unhandled backlog

Present `proposals[]` **one at a time** via `AskUserQuestion`, following `${CLAUDE_PLUGIN_ROOT}/skills/due-item-walk.md` — including its ban on asking how to scope the walk. Show the person, the relationship, the occurrence date, and how long ago it was.

Options per item:

- **Handled** — nothing owed. Record it and move on.
- **Still owed** — the user wants to do something about it. Create an inbox node naming the person and the occasion (`Send @Lindsay an anniversary note — Aug 20`), then record the date as handled so it does not resurface.
- **Skip** — write nothing; it returns next run.

Record handled dates by appending `{person, field, occurrence, decision, decidedAt}` to `.llm/gtd/review/relationship-dates-handled.json` (create as `[]` if missing), keyed `<personMention>:<field>:<ISO occurrence>`. Recording is what makes the backlog shrink to nothing once cleared; without it every past birthday returns forever.

## Report the rolls and defects

Fold the prep's `autoApplied` year-rolls into the summary as a single line (`🔁 Rolled 12 passed dates forward a year`), and surface any staged data defects by name so the user can fix the source fields.

## Return

Return success, empty, skipped, or failure to the DAG executor, which owns the prep node's schedule date.
