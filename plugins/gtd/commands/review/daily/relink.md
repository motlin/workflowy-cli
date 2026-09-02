---
description: Relink orphaned children — find tasks and entries misfiled under a Metadata navigation-link node, diagnose what put them there, then move them onto the real node the link points to. Use when the user wants to fix items misfiled under Metadata shortcuts or run the relink phase of the daily review.
---

# Relink Orphaned Children

Several nodes under `Metadata` are **navigation links** — their name is a single `<a href>` pointing at a real list elsewhere (e.g. `Metadata > ☑️ Next Actions > Personal ☑️ Next` links to `Personal > ☑️ Next`). These shortcuts are meant to be childless, but items occasionally get filed _under the link_ instead of under the node it points to.

## An orphan is a bug report, not a chore

**Finding an orphan means something upstream filed into the wrong node.** Moving it is the easy half; the half that matters is finding out what put it there, because a move without a diagnosis guarantees the same misfile tomorrow.

This phase used to be a shell script that moved orphans and printed a count. That was wrong twice over: it kept no durable record, and it discarded `createdAt` and the orphan's provenance children before anyone could look at them — so it destroyed the evidence needed to find the bug, silently, before any later phase could notice. Do not reintroduce that shape. In particular:

- **Never suppress the output of a move.** No `>/dev/null`, no `2>&1` on a `node move`. A failed move must be visible.
- **Never report a non-zero orphan count as routine.** `📊 3 orphans moved` is a bug going unreported. Say what created them.
- **Never move an orphan before its `createdAt` and provenance have been read.** The move is what destroys the trail.

Zero orphans is the expected result and needs no output at all.

## Scope

Walk exactly these seven GTD bucket categories under `Metadata`:

`📥 Inboxes`, `☑️ Next Actions`, `📅 Calendar`, `📤 Waiting For`, `🌱 Someday`, `📚 Reference`, `📁 Projects`

Scope is deliberately limited to these — **not** all of `Metadata` — so sections whose nodes legitimately have children (`👥 People`, `📂 Project Directories`, `🧠 Session Memory`, …) are never touched.

## Detect

For each category, fetch the bucket and its link nodes:

```bash
./bin/run.js node get --path "Metadata,<category>" --depth 3 --json \
  --fields name,id,children,linkTargets,createdAt
```

A missing bucket is skipped, not an error.

Within the result, walk down to the **first** node that has both a non-empty `linkTargets` and non-empty `children`. Its children are the orphans, and its `linkTargets[0]` is where they belong. Do **not** recurse into an orphan: it moves as an intact subtree, so an orphan that is itself a link node with its own metadata children (a project entry with `Description` / `GitHub` / `Status`) is never taken apart. Keep recursing through non-link containers in case links are nested.

Orphans are found by link resolution, never by name — their names and count are unknown in advance.

**If no orphans in any bucket: output nothing and return.** Do not announce a clean result.

## Diagnose before moving

For each orphan, before touching it:

- Read its `createdAt`.
- Read its children for provenance — `📜 Provenance:`, `From: <link>`, `➕ Added:`, capture timestamps, an Otter or Gmail URL.
- Read the orphan's own text for source markers.

Then correlate. Ask what could have written to a link node rather than its target at that timestamp:

- Does `createdAt` line up with a capture run, an Otter ingest, an item-mover batch, or a journal scanner in a recent session? The transcripts under `~/.claude/projects/-Users-craig-projects-workflowy/` are searchable, and `plugins/gtd/scripts/scan-review-feedback.mjs` shows the read pattern.
- Does the provenance name a specific agent or command? That command resolved a destination to the link node instead of its target — the bug is in how it resolves destinations.
- Do several orphans share a timestamp or a source? One buggy writer, not several.
- Is there no provenance and an odd hour? Likely filed by hand in the Workflowy app, which is a UI slip and not a code bug — say so rather than inventing a culprit.

**Report the finding to the user before the moves**, naming the suspected writer and the evidence. If the evidence is genuinely inconclusive, say that plainly — do not guess at a culprit to have an answer.

Per the skill-first rule in `daily.md`, if the diagnosis identifies an actual bug in a command or skill, fix it then, red/green.

## Move

Move each orphan to its link's target, letting the output through:

```bash
./bin/run.js node move --node-id <orphanId> --parent-id <targetId> -p bottom
```

Print one `✓ <orphan name> → <target name>` line per move. Surface any failure rather than continuing past it.

## Record durably

Console output does not survive a review the user is not watching. For each move, append one line to `.llm/gtd/relink-log.jsonl` (create if missing):

```text
{"movedAt":"<iso>","orphanId":"…","orphanName":"…","createdAt":"…","targetId":"…","targetName":"…","bucket":"☑️ Next Actions","provenance":"…","suspectedCause":"…"}
```

One record per line, appended — never rewritten, and never pretty-printed across lines.

Then log the anomaly under today's date node so it is visible next review:

```bash
TODAY=$(date +%Y-%m-%d)
./bin/run.js node create --parent-path "Metadata,🧠 Session Memory,$TODAY" \
  --name "Relink anomaly: <N> orphan(s) under <buckets> — suspected cause: <cause>" \
  --create-path --position bottom
```

The log is what makes a recurring misfile visible as a pattern across runs rather than as a fresh surprise each morning.

## Report

With orphans: report the count, each move, and the suspected cause with its evidence — as an anomaly needing a fix, not as tidy-up. With none: report nothing.

## Standalone use

Safe to run outside the daily review. It reads the Workflowy cache, so run the import barrier (`/gtd:daily-import`) first if the cache may be stale — a stale cache invents orphans that were already moved.
