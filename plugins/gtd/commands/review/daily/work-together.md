---
description: Close the daily review by offering to do real work together — on items overdue, due now, or due within the week; on the 1st tier of both asap ladders; and on items this run filed while their context is fresh. Each candidate names the concrete help on offer and is its own question; accepted items are worked on the spot. Use when the user wants to work through their most pressing tasks with Claude, or run the work-together phase of the daily review.
---

# Work Together

The rest of the review sorts, ranks, and dates work. This phase does some of it. With the ladders ranked and the dated items walked, look at what is left and offer to work on the items where Claude can actually help, right now, in this session.

Scope is **both** roots linked from `Metadata > ☑️ Next Actions` (`d81ba063-5604-49a5-bb87-0d0fe59d0a48`), Work and Personal, discovered by link resolution and never hardcoded, plus Things 3 and Apple Reminders for the dated category.

## Do not use the built-in task list

Track progress through `.llm/` files and inline status updates. Do **not** create Claude Code built-in tasks (`TaskCreate` / `TaskUpdate` / `TodoWrite`) for the per-item work here.

## Run last

In the daily review this phase runs after the Recurring Review. It needs the due walk's handled outcomes so it never offers help on something the user just called done, and the rebalanced `1st` tier so the ranking it reads is today's. When invoked standalone, it runs on whatever the ladders and buckets hold now.

## Gather the three categories

Build every category from a **fresh** read. The earlier phases moved, completed, and rescheduled items, so any export they left in `.llm/gtd/review/` is stale for this purpose.

- **Due now or soon.** Re-run the Workflowy Next-Actions and Things fetches from `${CLAUDE_PLUGIN_ROOT}/commands/review/daily/due.md` under **Fetch every source before the first question**, overwriting `due-workflowy.json` and `due-things.json`. Reuse the staged `due-reminders.json`; do not launch `reminders-fetcher` again. Then collect with a one-week horizon:

    ```bash
    node ${CLAUDE_PLUGIN_ROOT}/scripts/collect-due-items.mjs \
      --workflowy .llm/gtd/review/due-workflowy.json \
      --things .llm/gtd/review/due-things.json \
      --reminders .llm/gtd/review/due-reminders.json \
      --horizon-days 7 \
      > .llm/gtd/review/work-together-due.json
    ```

    A negative `overdueByDays` means the item is due that many days from now. Drop every row that already has a handled (non-`skip`) record dated today in `.llm/gtd/review/skip-log.jsonl` under its `<source>:<id>` key; the user just dealt with it.

- **`1st` tier.** Export each root's `📌 Tasks (asap)` bucket and read `dayPlan` from the `rebalance` report exactly as `${CLAUDE_PLUGIN_ROOT}/commands/review/daily/rebalance.md` does under **Read both ladders**. Take the `1st` tier's items only. **Never read a ladder off a mirror**: confirm `mirror.isMirror` is false on each bucket.

- **Filed this run.** Items the Process Inbox, File Loose Tasks, and Meeting Follow-up phases created or moved in this session, while their source (the email, the meeting transcript, the captured note) is still in context. Build the list from this run's artifacts, not from memory, since the conversation may have been compacted: `.llm/gtd-refined-items.json`, `.llm/gtd/review/proposals/file-tasks.json`, and the meeting follow-ups under `.llm/gtd/review/meetings/`. Keep only items that are still open in the fresh exports above.

An item that lands in several categories appears once, under the first category that holds it in the order above.

## Keep only items Claude can help with

For each candidate, name the **concrete** help on offer, or drop it. Concrete means an action this session can take: draft the email or message, write or fix the code, research the question and summarize the answer, fill in the form's content, draft the doc or agenda, find the booking options. For code, resolve the working directory from `Metadata > 📂 Project Directories` instead of guessing a path.

Drop items that need the user's body or presence (a haircut, a phone call only they can make, a physical errand), items that are only a reminder to decide something, and items whose next step is waiting on someone else. "I can help you think about it" is not concrete help; when that is all there is, drop the item.

Read each surviving item's subtree (children, note, links) before proposing, per **Show the item, do not just name it** in `${CLAUDE_PLUGIN_ROOT}/skills/due-item-walk.md`. The offer has to rest on what the item actually says.

## Offer each item

Present the categories in order: due, then `1st` tier, then filed this run. Ask about one item per question through `AskUserQuestion`; one call may carry up to 4 questions, never two items in one question. Print the item's context block immediately before the call. Do **not** open with a question about how many items to cover or which category to start with. Go straight to the first item.

Each question names the item, its category and why it qualifies (`Due in 2 days`, `1st tier, Work`, `Filed today from the inbox`), and the specific help in one sentence. Options:

- **Work on it now** — the help, stated as the option label's description, e.g. `Draft the reply to @Alice's contract question`.
- **Not now** — leave the item exactly where it is.
- **Already done** — the user finished it outside the review. Complete it with the same per-source operation the due walk uses (a `complete` op from the row's `ops`, or `node complete --id <uuid>` for a ladder item), then read it back.

## Work accepted items one at a time

When the user accepts, do the work before offering the next item. Work that needs its own project runs there: code goes in the item's project directory with that project's red/green TDD and precommit rules, not in this repository. Show the result (the draft, the diff, the research summary) and ask whether the item is now done. Only a confirmed done completes the item; a partial result stays open with a child node recording where the work stopped, so the next run resumes from it rather than rebuilding it.

The review's rules still hold here: never offer to pause or wrap up because the list is long, and an improvement idea goes to `.llm/gtd/review/mid-run-notes.md` rather than stopping the walk.

## Finish

Print one line per category, e.g. `✓ Due: 2 worked, 1 done, 3 not now · 1st tier: 1 worked · Filed: 0 offered`. Silent when no candidate survived the help filter.
