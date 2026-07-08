---
description: Relink orphaned children — move tasks and entries that got filed under a Metadata navigation-link node onto the real node the link points to. Mechanical, automatic, and reversible. Use when the user wants to fix items misfiled under Metadata shortcuts or run the relink phase of the daily review.
---

# Relink Orphaned Children

Several nodes under `Metadata` are **navigation links** — their name is a single `<a href>` pointing at a real list elsewhere (e.g. `Metadata > ☑️ Next Actions > Personal ☑️ Next` links to `Personal > ☑️ Next`). These shortcuts are meant to be childless, but tasks and entries occasionally get filed _under the link_ instead of under the node it points to. This step relocates each such orphan to the link's target.

The work is mechanical, deterministic, and safe (every move is reversible), so it runs **fully automatic** with no per-item confirmation.

## Run it

```bash
./${CLAUDE_PLUGIN_ROOT}/scripts/relink-orphans.sh
```

Preview without moving anything:

```bash
./${CLAUDE_PLUGIN_ROOT}/scripts/relink-orphans.sh --dry-run
```

The script iterates the GTD bucket categories under `Metadata` (📥 Inboxes, ☑️ Next Actions, 📅 Calendar, 📤 Waiting For, 🌱 Someday, 📚 Reference, 📁 Projects). Within each it finds every navigation link that has children and moves each child (as an intact subtree) to `linkTargets[0]` — the node the link resolves to. It stops at the first link node on each branch, so a moved orphan that is itself a link node (e.g. a project entry with its own `Description` / `GitHub` / `Status` metadata children) moves whole and is never taken apart. The orphan count and names per bucket are unknown and irrelevant — orphans are found by link resolution, not by name. It prints a `✓ <orphan> → <target>` line per move and a count; re-running is a no-op once everything is relinked.

Scope is deliberately limited to those bucket categories, **not** all of `Metadata`, so sections whose nodes legitimately have children (`👥 People`, `📂 Project Directories`, `🧠 Session Memory`, …) are never touched.

## Options

- `--category NAME` — limit to one bucket category, repeatable (default: all seven)
- `--dry-run` — report what would move without moving

Report the summary to the user when invoked as part of the daily review.
