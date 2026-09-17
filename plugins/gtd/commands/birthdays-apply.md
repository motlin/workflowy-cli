---
name: birthdays-apply
description: Announce birthdays and anniversaries for today and the next three days prominently, then walk every relationship date from the last year that still needs handling, one at a time.
---

# Birthdays — Apply

The interactive half of the birthdays split. Reads what `/gtd:birthdays-prep` staged at `.llm/gtd/review/proposals/birthdays.json`.

## Prerequisite and freshness

Run `/gtd:birthdays-prep` first; in the daily review it runs automatically as a Phase 0 prep subagent.

**Check `generatedFor` against today's date before presenting anything.** A long review can cross midnight, and a briefing computed for yesterday will announce yesterday's events and stay silent about today's. If they differ, re-run the prep for the current day and use the fresh result. This is not optional — it is exactly how an anniversary passed unannounced on 2026-08-20 during a review that started on the 19th.

## Announce today and the next three days through AskUserQuestion

Before any walking, put the `today` and `imminent` arrays in front of the user with `AskUserQuestion` — never as a printed block, and never as text surrounding the tool call. Console text scrolls past during a review; a birthday announced only there is one the user never saw, and it then returns a day later as backlog for an occasion they were never really told about.

The next three days get the same treatment as today because the review is often run in the evening rather than the morning: a birthday tomorrow announced only as a quiet heads-up tonight is one the user finds out about tomorrow, after the window to mail a card or plan a call has closed.

First drop every entry already recorded in `.llm/gtd/review/relationship-dates-handled.json` — those were acknowledged on an earlier run — and print them as quiet one-liners instead. If nothing is left to ask about, say so in one line and move on without a question.

Then ask **one question per entry**, today's entries first, then the imminent ones in date order, batching up to four questions per call. Each question's text is that entry's whole announcement, prefixed with its staged `label` in caps, so it reads on its own:

```text
🎂 TODAY — @Alice (your sister) turns 40
💍 TODAY — @Bob and @Carol's 3rd anniversary (married Sep 7, 2023)
🎂 TOMORROW — @Dave turns 12
💍 WED — @Erin and @Frank's 10th anniversary (married Sep 9, 2016)
```

Say who they are from the `👥 Relationship:` field when it is close family — "your sister" carries weight that a bare `@mention` does not.

Options per entry:

- **Handled** — the user has it covered (called, card sent, gift bought) or owes nothing. Record it.
- **Still owed** — create an inbox node naming the person and the occasion (`Call @Alice for her birthday — Sep 7`), then record it.
- **Remind me next run** — write nothing. An imminent entry is announced again tomorrow; a today entry returns as backlog once prep rolls it.

Record with the same append the backlog walk uses below, keyed on the announced occurrence date. That record is what keeps an acknowledged date from resurfacing as backlog after prep rolls it forward.

Finally, print `upcoming` (days 4-14) as clearly-dated heads-up lines. These stay printed and quiet — they need no answer yet, and each one gets its own question once it comes within three days.

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
