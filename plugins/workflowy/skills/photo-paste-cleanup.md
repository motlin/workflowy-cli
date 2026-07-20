---
name: photo-paste-cleanup
description: Fix calendar photo pastes that Workflowy wrapped in a blank node or listed in reverse order. Use when photos under a journal entry look backwards, sit under an empty bullet, or the user asks to clean up pasted photos.
---

# Photo Paste Cleanup

Pasting several photos at once into a calendar entry produces two defects:

- Workflowy sometimes wraps the photos in an extra, otherwise-empty node under the entry.
- The photos land in reverse order top-to-bottom.

The `calendar:fix-photo-groups` command detects both and repairs them.

## Running It

Always preview first — the command mutates Workflowy through the API:

```bash
./bin/run.js calendar fix-photo-groups --dry-run
```

Fix one group at a time while verifying, passing either the blank wrapper's ID or the entry's ID:

```bash
./bin/run.js calendar fix-photo-groups --node-id <wrapper-or-entry-id>
```

Other flags: `--batch-size N` to cap how many groups get fixed, `--delay MS` for the pause between API calls (default 1000).

The operation is idempotent — a fixed group stops matching the reverse rule, so re-running is safe.

## What It Does to a Group

Photos move to the bottom of the calendar entry in chronological order, and an emptied wrapper is deleted. The move API only accepts `top` or `bottom`, so a group that sat mid-entry ends up at the bottom.

## What It Refuses to Touch

The command only reverses a group when it has evidence, because a wrong reversal is invisible later:

- **`IMG_NNNN` filenames** are the chronological signal — the cache holds no EXIF data. Descending numbers mean reversed; ascending means already correct.
- **Wrapped groups with unusable filenames** (generic `image.jpeg`) get reversed anyway — the wrapper itself proves a single paste batch. Loose groups in the same state are left alone.
- **Photos created more than five minutes apart** are separate pastes, so their relative order carries no information.
- **Mirrors** render blank in the cache and look exactly like photo nodes. They are excluded, as are blank nodes with no image attachment (pasted HTML tables produce these).

## Attachment Data Comes Only From Backups

Filenames and MIME types live in the `s3_files` table, which **only backup imports populate** — `import-api` never writes it. Photos pasted since the last backup have no filename evidence, so recent loose groups get skipped. Import a fresh backup before expecting the newest pastes to be fixable.

## Verifying a Fix

Re-read the entry and confirm the wrapper is gone and the order flipped:

```bash
./bin/run.js node get --id <entry-id> --depth 2
```

For filename-backed groups, check the order directly against the cache after a re-import — priorities should ascend alongside the `IMG_NNNN` numbers.
