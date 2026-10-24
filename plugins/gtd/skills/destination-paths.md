---
name: destination-paths
description: Rule for how every AskUserQuestion that proposes a move, merge, or file-under target must display that target - the full Workflowy path from the root plus the target title, never elided. Load before writing any destination, merge, or filing question.
---

# Destination Paths

The user does not remember where nodes live. Any `AskUserQuestion` that proposes a move, merge, or file-under target must show the target's **full path from the root** inside the question body, so the choice can be made without looking anything up.

- Write every ancestor from the root down, separated by `>` (`Work > ☑️ Next (Work) > Dependency upgrades`).
- Never elide with `…`, `...`, or "under X"; never abbreviate a tier or bucket to a shorthand like `Work > 4th`. A ladder tier is written in full: `Work > 📌 Tasks (asap) > 4th`.
- End the path with the target's own title, so the last segment is the node the item lands on or merges into.
- Applies to the recommended destination, every alternative, a Merge-with target, and a matched existing task. Option labels may stay short only when the question body repeats the full path.
- Resolve the path from the live node (ancestors read from the cache), not from a remembered or staged string that may be stale. Verify the node still exists first.
