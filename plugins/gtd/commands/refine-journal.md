---
name: refine-journal
description: Refine calendar journal entries (people, hobby, category, typo, emoji tags) one month at a time. Standalone wrapper that chains the prep and apply halves. Use when the user wants to refine, tag, or clean up their calendar journal / past activity log outside the daily review.
---

# Refine Journal

This command was split into two focused halves so the daily review's Phase 0 DAG can run the autonomous compute in parallel and defer the interactive confirmation:

- **`/gtd:refine-journal-prep`** — load metadata, scan the next month, compute people/hobby/category/typo/emoji refinements, and stage them to `.llm/gtd/review/proposals/refine-journal.json`. Mutates no nodes; does not advance Scanner-State.
- **`/gtd:refine-journal-apply`** — read the staged file, walk the batches-of-4 confirmation loop, apply accepted updates, advance Scanner-State and the review date.

For a standalone manual run, invoke them in order: run `/gtd:refine-journal-prep`, then `/gtd:refine-journal-apply`.

The on-disk contract both halves share is documented in `${CLAUDE_PLUGIN_ROOT}/skills/review-proposal-staging.md`.
